import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.List;

/** Reads only the primitive kapt metadata format; never calls readObject(). */
public final class KaptMetadataReader {
  private static final int MAX_BYTES = 8 * 1024 * 1024, MAX_ENTRIES = 20_000, MAX_STRING = 16 * 1024;
  public static void main(String[] args) throws Exception {
    if (args.length != 1) throw new IllegalArgumentException("manifest path required");
    if (new File(args[0]).length()>4*1024*1024)throw new IOException("metadata manifest byte limit");
    List<String> files = java.nio.file.Files.readAllLines(new File(args[0]).toPath(), StandardCharsets.UTF_8);
    if (files.size() > MAX_ENTRIES) throw new IOException("metadata manifest limit");
    StringBuilder batch = new StringBuilder("{\"files\":{");
    for (int fileIndex = 0; fileIndex < files.size(); fileIndex++) {
      String path = files.get(fileIndex);
      if (path.isEmpty() || path.length() > MAX_STRING || new File(path).isDirectory()) throw new IOException("metadata path invalid");
      String json = readFile(path);
      if (fileIndex > 0) batch.append(',');
      batch.append(quote(path)).append(':').append(json);
      if(batch.length()>16*1024*1024)throw new IOException("metadata output limit");
    }
    System.out.println(batch.append("}}"));
  }
  private static String readFile(String path) throws Exception {
    if (new File(path).length() > MAX_BYTES) throw new IOException("metadata size limit");
    try (ObjectInputStream input = new ObjectInputStream(new BufferedInputStream(new FileInputStream(path)))) {
      int version = input.readInt();
      if (version != 1) throw new IOException("unsupported kapt metadata version: " + version);
      int lines = input.readInt();
      if (lines < 0 || lines > MAX_ENTRIES) throw new IOException("metadata line limit");
      StringBuilder json = new StringBuilder("{\"version\":1,\"lines\":{");
      for (int i = 0; i < lines; i++) {
        String key = input.readUTF();
        String sourcePath = input.readUTF();
        if (key.length() > MAX_STRING || sourcePath.length() > MAX_STRING || !new File(sourcePath).isAbsolute()) throw new IOException("metadata string limit/path");
        boolean start = input.readBoolean();
        int line = input.readInt();
        if (i > 0) json.append(',');
        json.append(quote(key)).append(":{").append("\"path\":").append(quote(sourcePath)).append(",\"start\":").append(start).append(",\"line\":").append(line).append('}');
      }
      int signatures = input.readInt();
      if (signatures < 0 || signatures > MAX_ENTRIES) throw new IOException("metadata signature limit");
      json.append("},\"signatures\":{");
      for (int i = 0; i < signatures; i++) {
        if (i > 0) json.append(',');
        String key = input.readUTF(), value = input.readUTF();
        if (key.length() > MAX_STRING || value.length() > MAX_STRING) throw new IOException("metadata string limit");
        json.append(quote(key)).append(':').append(quote(value));
      }
      json.append("}}\n");
      return json.toString();
    }
  }
  private static String quote(String value) {
    StringBuilder out = new StringBuilder("\"");
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      if (c == '\\' || c == '"') out.append('\\');
      if (c < 0x20) out.append(String.format("\\u%04x", (int)c)); else out.append(c);
    }
    return out.append('"').toString();
  }
}
