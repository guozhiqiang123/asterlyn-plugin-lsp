import java.io.*;
import java.nio.charset.StandardCharsets;

/** Reads only the primitive kapt metadata format; never calls readObject(). */
public final class KaptMetadataReader {
  private static final int MAX_BYTES = 8 * 1024 * 1024, MAX_ENTRIES = 20_000, MAX_STRING = 16 * 1024;
  public static void main(String[] args) throws Exception {
    if (args.length != 1) throw new IllegalArgumentException("metadata path required");
    if (new File(args[0]).length() > MAX_BYTES) throw new IOException("metadata size limit");
    try (ObjectInputStream input = new ObjectInputStream(new BufferedInputStream(new FileInputStream(args[0])))) {
      int version = input.readInt();
      if (version != 1) throw new IOException("unsupported kapt metadata version: " + version);
      int lines = input.readInt();
      if (lines < 0 || lines > MAX_ENTRIES) throw new IOException("metadata line limit");
      StringBuilder json = new StringBuilder("{\"version\":1,\"lines\":{");
      for (int i = 0; i < lines; i++) {
        String key = input.readUTF();
        String path = input.readUTF();
        if (key.length() > MAX_STRING || path.length() > MAX_STRING || !new File(path).isAbsolute()) throw new IOException("metadata string limit/path");
        boolean start = input.readBoolean();
        int line = input.readInt();
        if (i > 0) json.append(',');
        json.append(quote(key)).append(":{").append("\"path\":").append(quote(path)).append(",\"start\":").append(start).append(",\"line\":").append(line).append('}');
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
      System.out.print(json);
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
