import java.io.*;
import java.nio.charset.StandardCharsets;

/** Reads only the primitive kapt metadata format; never calls readObject(). */
public final class KaptMetadataReader {
  public static void main(String[] args) throws Exception {
    if (args.length != 1) throw new IllegalArgumentException("metadata path required");
    try (ObjectInputStream input = new ObjectInputStream(new BufferedInputStream(new FileInputStream(args[0])))) {
      int version = input.readInt();
      if (version != 1) throw new IOException("unsupported kapt metadata version: " + version);
      int lines = input.readInt();
      StringBuilder json = new StringBuilder("{\"version\":1,\"lines\":{");
      for (int i = 0; i < lines; i++) {
        String key = input.readUTF();
        String path = input.readUTF();
        boolean start = input.readBoolean();
        int line = input.readInt();
        if (i > 0) json.append(',');
        json.append(quote(key)).append(":{").append("\"path\":").append(quote(path)).append(",\"start\":").append(start).append(",\"line\":").append(line).append('}');
      }
      int signatures = input.readInt();
      json.append("},\"signatures\":{");
      for (int i = 0; i < signatures; i++) {
        if (i > 0) json.append(',');
        json.append(quote(input.readUTF())).append(':').append(quote(input.readUTF()));
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
