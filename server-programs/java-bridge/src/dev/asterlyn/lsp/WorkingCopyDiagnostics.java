package dev.asterlyn.lsp;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.eclipse.core.runtime.IProgressMonitor;
import org.eclipse.jdt.core.ICompilationUnit;
import org.eclipse.jdt.core.IJavaProject;
import org.eclipse.jdt.core.compiler.IProblem;
import org.eclipse.jdt.core.dom.AST;
import org.eclipse.jdt.core.dom.ASTParser;
import org.eclipse.jdt.core.dom.CompilationUnit;
import org.eclipse.jdt.ls.core.internal.IDelegateCommandHandler;
import org.eclipse.jdt.ls.core.internal.JDTUtils;

/** A pull result from the exact unsaved working-copy text, never a restamped push notification. */
public final class WorkingCopyDiagnostics implements IDelegateCommandHandler {
    @Override
    public Object executeCommand(String command, List<Object> arguments, IProgressMonitor monitor) throws Exception {
        if ("asterlyn.java.refreshModel".equals(command)) {
            org.eclipse.core.resources.ResourcesPlugin.getWorkspace().getRoot().refreshLocal(org.eclipse.core.resources.IResource.DEPTH_INFINITE, monitor);
            return null;
        }
        if ("asterlyn.java.declarationLocation".equals(command)) return DeclarationKey.locate(arguments, monitor);
        if ("asterlyn.java.declarationKey".equals(command)) return DeclarationKey.execute(arguments, monitor);
        if (!"asterlyn.java.documentDiagnostics".equals(command) || arguments.size() != 1
                || !(arguments.get(0) instanceof Map<?, ?> request)
                || !(request.get("uri") instanceof String uri)
                || !(request.get("digest") instanceof String expected)
                || !(request.get("version") instanceof Number version)
                || (request.containsKey("syntaxOnly") && !(request.get("syntaxOnly") instanceof Boolean))) {
            throw new IllegalArgumentException("invalid-diagnostic-request");
        }
        ICompilationUnit unit = JDTUtils.resolveCompilationUnit(uri);
        if (unit == null || unit.getBuffer() == null) throw new IllegalStateException("document-not-in-model");
        String text = unit.getBuffer().getContents();
        if (text.length() > 2 * 1024 * 1024 || !digest(text).equals(expected)) {
            throw new IllegalStateException("document-content-modified");
        }
        boolean syntaxOnly = Boolean.TRUE.equals(request.get("syntaxOnly"));
        CompilationUnit ast = syntaxOnly
            ? parseCurrentSyntax(unit, text, monitor)
            : unit.reconcile(AST.getJLSLatest(), ICompilationUnit.FORCE_PROBLEM_DETECTION, null, monitor);
        if (ast == null) throw new IllegalStateException("document-not-a-working-copy");
        if (monitor.isCanceled() || !digest(unit.getBuffer().getContents()).equals(expected)) {
            throw new IllegalStateException("document-content-modified");
        }
        List<Map<String, Object>> diagnostics = new ArrayList<>();
        PositionIndex positions=new PositionIndex(text);
        for (IProblem problem : ast.getProblems()) {
            // Syntax-only diagnostics must never expose semantic/type results from
            // an ABI that may be stale while the Kotlin model is rebuilding.
            if (syntaxOnly && (problem.getID() & IProblem.Syntax) == 0) continue;
            if (diagnostics.size() >= 512) break;
            int start = problem.getSourceStart();
            int end = problem.getSourceEnd() + 1;
            if (start < 0 || start > end || end > text.length()) continue;
            String message = problem.getMessage();
            if (message.length() > 4096) message = message.substring(0, 4096);
            diagnostics.add(Map.of("range", Map.of("start", positions.at(start), "end", positions.at(end)),
                "severity", problem.isError() ? 1 : problem.isWarning() ? 2 : 3,
                "message", message, "source", "jdt", "code", Integer.toString(problem.getID())));
        }
        return Map.of("version", version.longValue(), "digest", expected, "items", diagnostics);
    }

    /** Parse the captured overlay directly so syntax diagnostics never use stale model state. */
    private static CompilationUnit parseCurrentSyntax(ICompilationUnit unit, String text, IProgressMonitor monitor) {
        ASTParser parser = ASTParser.newParser(AST.getJLSLatest());
        parser.setSource(text.toCharArray());
        parser.setKind(ASTParser.K_COMPILATION_UNIT);
        parser.setResolveBindings(false);
        parser.setBindingsRecovery(false);
        parser.setStatementsRecovery(true);
        IJavaProject project = unit.getJavaProject();
        if (project != null) parser.setCompilerOptions(project.getOptions(true));
        return (CompilationUnit) parser.createAST(monitor);
    }

    private static String digest(String text) throws Exception {
        return "sha256:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
    }

    private static final class PositionIndex {
        private int[] starts=new int[1024];
        private int count=1;
        PositionIndex(String text){for(int index=0;index<text.length();index++)if(text.charAt(index)=='\n'){
            if(count==starts.length)starts=java.util.Arrays.copyOf(starts,starts.length*2);
            starts[count++]=index+1;
        }}
        Map<String,Integer> at(int offset){int index=java.util.Arrays.binarySearch(starts,0,count,offset);int line=index>=0?index:-index-2;return Map.of("line",line,"character",offset-starts[line]);}
    }
}
