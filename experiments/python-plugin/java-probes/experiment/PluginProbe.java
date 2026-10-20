package experiment;

import com.jetbrains.python.PyNames;
import com.jetbrains.python.lexer.PythonLexerKind;

public final class PluginProbe {
    public static void main(String[] args) {
        // Force initialization of the original Python CE plugin class rather than
        // merely inlining a compile-time constant from its bytecode.
        int initialized = PyNames.INSTANCE.hashCode();
        int stringTypeCount = PyNames.TYPE_STRING_TYPES.size();
        String lexerKind = PythonLexerKind.REGULAR.name();
        System.out.println("Python CE PyNames initialized; string types=" + stringTypeCount
                + "; lexer kind=" + lexerKind + "; identity=" + initialized);
    }
}
