package dev.asterlyn.lsp;
import java.util.*;
import org.eclipse.core.runtime.IProgressMonitor;
import org.eclipse.jdt.core.*;
import org.eclipse.jdt.ls.core.internal.JDTUtils;

/** KAPT-compatible JVM keys derived from JDT semantic declarations, including overloads. */
final class DeclarationKey {
    static Object execute(List<Object> arguments, IProgressMonitor monitor) throws Exception {
        if(arguments.size()!=1 || !(arguments.get(0) instanceof Map<?,?> input)
            || !(input.get("uri") instanceof String uri) || !(input.get("line") instanceof Number line)
            || !(input.get("character") instanceof Number character)) throw new IllegalArgumentException("invalid-declaration-request");
        ICompilationUnit unit=JDTUtils.resolveCompilationUnit(uri);
        if(unit==null || unit.getBuffer()==null)throw new IllegalStateException("declaration-not-in-model");
        String text=unit.getBuffer().getContents(); if(text.length()>2*1024*1024)throw new IllegalArgumentException("declaration-size-bound");
        int start=0;for(int count=0;count<line.intValue();count++){int next=text.indexOf('\n',start);if(next<0)throw new IllegalArgumentException("invalid-declaration-position");start=next+1;}
        int offset=start+character.intValue();if(line.intValue()<0||character.intValue()<0||offset>text.length())throw new IllegalArgumentException("invalid-declaration-position");
        IJavaElement[] selected=unit.codeSelect(offset,0);IJavaElement element=selected.length>0?selected[0]:unit.getElementAt(offset);
        if(monitor.isCanceled()||element==null)return null;
        String key=keyOf(element);return key==null?null:Map.of("key",key);
    }
    /** Exact compiler-emitted JVM key, never a name-only match. */
    static Object locate(List<Object> arguments,IProgressMonitor monitor)throws Exception {
        if(arguments.size()!=1||!(arguments.get(0) instanceof Map<?,?> input)||!(input.get("uri") instanceof String uri)||!(input.get("key") instanceof String key)||key.length()>8192)throw new IllegalArgumentException("invalid-declaration-key");
        ICompilationUnit unit=JDTUtils.resolveCompilationUnit(uri);if(unit==null||unit.getBuffer()==null)return null;
        String text=unit.getBuffer().getContents();if(text.length()>2*1024*1024)throw new IllegalArgumentException("declaration-size-bound");
        int count=0;
        for(IType type:unit.getAllTypes()) {
            List<IMember> members=new ArrayList<>();members.add(type);members.addAll(Arrays.asList(type.getFields()));members.addAll(Arrays.asList(type.getMethods()));
            for(IMember member:members) {
                if(monitor.isCanceled())return null;if(++count>20000)throw new IllegalArgumentException("declaration-count-bound");
                String candidate;try{candidate=keyOf(member);}catch(Exception ignored){continue;}
                if(!key.equals(candidate))continue;
                ISourceRange range=member.getNameRange();if(range==null||range.getOffset()<0)return null;
                int offset=range.getOffset(),line=0,start=0;for(int index=0;index<offset;index++)if(text.charAt(index)=='\n'){line++;start=index+1;}
                return Map.of("uri",uri,"range",Map.of("start",Map.of("line",line,"character",offset-start),"end",Map.of("line",line,"character",offset-start+range.getLength())));
            }
        }
        return null;
    }
    private static String keyOf(IJavaElement element)throws Exception {
        String key;
        if(element instanceof IMethod method){
            IType type=method.getDeclaringType();StringBuilder signature=new StringBuilder(typeName(type)).append('#').append(method.isConstructor()?"<init>":method.getElementName()).append('(');
            for(String parameter:method.getParameterTypes())signature.append(descriptor(parameter,type,method));
            signature.append(')').append(method.isConstructor()?"V":descriptor(method.getReturnType(),type,method));key=signature.toString();
        }else if(element instanceof IField field){key=typeName(field.getDeclaringType())+"#"+field.getElementName();}
        else if(element instanceof IType type){key=typeName(type);}
        else return null;
        return key;
    }
    private static String typeName(IType type){return type.getFullyQualifiedName('$').replace('.','/');}
    private static String descriptor(String signature,IType owner,IMethod method)throws Exception{
        int arrays=Signature.getArrayCount(signature);String element=Signature.getElementType(signature);String result;
        switch(Signature.getTypeSignatureKind(element)){
            case Signature.BASE_TYPE_SIGNATURE: result=element;break;
            case Signature.TYPE_VARIABLE_SIGNATURE:
                String variable=Signature.toString(element);ITypeParameter parameter=method.getTypeParameter(variable);
                if(!parameter.exists())parameter=owner.getTypeParameter(variable);
                String[] bounds=parameter.exists()?parameter.getBoundsSignatures():new String[0];
                result=bounds.length==0?"Ljava/lang/Object;":descriptor(bounds[0],owner,method);break;
            case Signature.CLASS_TYPE_SIGNATURE:
                String erased=Signature.getTypeErasure(element);String name=Signature.toString(erased);
                if(erased.charAt(0)=='L'){result="L"+name.replace('.','/')+";";break;}
                String[][] resolved=owner.resolveType(name);
                if(resolved==null||resolved.length!=1)throw new IllegalStateException("declaration-type-unresolved");
                String qualified=resolved[0][0].isEmpty()?resolved[0][1]:resolved[0][0]+"."+resolved[0][1];
                IType type=owner.getJavaProject().findType(qualified);result="L"+(type==null?qualified.replace('.','/'):typeName(type))+";";break;
            default:throw new IllegalArgumentException("unsupported-declaration-signature");
        }
        return "[".repeat(arrays)+result;
    }
}
