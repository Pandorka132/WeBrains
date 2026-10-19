package experiment;

import com.intellij.psi.tree.IElementType;
import com.jetbrains.python.lexer.PythonLexerKind;
import com.jetbrains.python.lexer._PythonLexer;

/**
 * Exposes the original Python CE lexer as a JSON-lines-compatible host API.
 *
 * With no arguments, runs the fixed regression fixture. With one argument, tokenizes
 * that source string. The browser worker invokes the same entry point repeatedly in
 * the already initialized Web Image instance.
 */
public final class LexerProbe {
    private static final String DEFAULT_SOURCE =
            "def greet(name):\n    return f'Hello, {name}!'\n";

    private LexerProbe() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length > 0 && "--webrains-init".equals(args[0])) {
            return;
        }

        String source = args.length == 0 ? DEFAULT_SOURCE : args[0];
        String json = tokenize(source);
        System.out.println("LEXER_JSON:" + json);

        if (args.length == 0) {
            if (!json.contains("\"type\":\"Py:DEF_KEYWORD\"")
                    || !json.contains("\"type\":\"Py:FSTRING_START\"")) {
                throw new IllegalStateException("Python CE lexer smoke test did not find expected tokens");
            }
            System.out.println("LEXER_OK tokens=" + countTokens(json));
        } else {
            System.out.println("LEXER_API_OK");
        }
    }

    private static String tokenize(String source) throws Exception {
        _PythonLexer lexer = new _PythonLexer(null, PythonLexerKind.REGULAR);
        lexer.reset(source, 0, source.length(), 0);

        StringBuilder result = new StringBuilder("[");
        boolean first = true;
        IElementType token;
        while ((token = lexer.advance()) != null) {
            int start = lexer.getTokenStart();
            int end = lexer.getTokenEnd();
            if (start < 0 || end < start || end > source.length()) {
                throw new IllegalStateException("Invalid lexer range: " + start + ".." + end);
            }
            if (!first) {
                result.append(',');
            }
            first = false;
            result.append("{\"type\":\"").append(escape(token.toString()))
                    .append("\",\"start\":").append(start)
                    .append(",\"end\":").append(end)
                    .append(",\"text\":\"").append(escape(source.substring(start, end)))
                    .append("\"}");
        }
        return result.append(']').toString();
    }

    private static int countTokens(String json) {
        if ("[]".equals(json)) {
            return 0;
        }
        int count = 0;
        for (int i = 0; i < json.length(); i++) {
            if (json.charAt(i) == '{' && (i == 0 || json.charAt(i - 1) == '[' || json.charAt(i - 1) == ',')) {
                count++;
            }
        }
        return count;
    }

    private static String escape(String value) {
        StringBuilder escaped = new StringBuilder(value.length() + 16);
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            switch (character) {
                case '"' -> escaped.append("\\u0022");
                case '\\' -> escaped.append("\\\\");
                case '\n' -> escaped.append("\\n");
                case '\r' -> escaped.append("\\r");
                case '\t' -> escaped.append("\\t");
                case '\b' -> escaped.append("\\b");
                case '\f' -> escaped.append("\\f");
                default -> {
                    if (character < 0x20) {
                        escaped.append(String.format("\\u%04x", (int) character));
                    } else {
                        escaped.append(character);
                    }
                }
            }
        }
        return escaped.toString();
    }
}
