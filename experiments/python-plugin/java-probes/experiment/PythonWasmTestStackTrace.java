package experiment;

import com.oracle.svm.core.annotate.Alias;
import com.oracle.svm.core.annotate.Substitute;
import com.oracle.svm.core.annotate.TargetClass;

/**
 * Test-only replacement for StackTraceElement.toString() in the single-threaded
 * WebAssembly inspection image.
 *
 * JDK 25 formats a stack frame through StringBuilder. The current WASM image has
 * an unresolved virtual dispatch on the AbstractStringBuilder.length() path.
 * Build the same textual representation with String.concat instead, leaving
 * stack capture and all inspection/indexing behavior unchanged.
 *
 * Never include this substitution in a production plugin artifact.
 */
@TargetClass(className = "java.lang.StackTraceElement")
final class TargetStackTraceElementForWasmTest {
    @Alias private String classLoaderName;
    @Alias private String moduleName;
    @Alias private String moduleVersion;
    @Alias private String declaringClass;
    @Alias private String methodName;
    @Alias private String fileName;
    @Alias private int lineNumber;
    @Alias private byte format;

    @Alias
    public native boolean isNativeMethod();

    @Substitute
    public String toString() {
        String result = "";

        if ((format & 1) == 0 && classLoaderName != null && !classLoaderName.isEmpty()) {
            result = result.concat(classLoaderName).concat("/");
        }

        if (moduleName != null && !moduleName.isEmpty()) {
            result = result.concat(moduleName);
            if ((format & 2) == 0 && moduleVersion != null && !moduleVersion.isEmpty()) {
                result = result.concat("@").concat(moduleVersion);
            }
        }

        if (!result.isEmpty()) {
            result = result.concat("/");
        }
        result = result.concat(declaringClass).concat(".").concat(methodName).concat("(");

        if (isNativeMethod()) {
            result = result.concat("Native Method");
        } else if (fileName == null) {
            result = result.concat("Unknown Source");
        } else {
            result = result.concat(fileName);
            if (lineNumber >= 0) {
                result = result.concat(":").concat(Integer.toString(lineNumber));
            }
        }

        return result.concat(")");
    }
}
