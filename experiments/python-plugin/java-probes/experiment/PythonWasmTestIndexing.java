package experiment;

import com.oracle.svm.core.annotate.Substitute;
import com.oracle.svm.core.annotate.TargetClass;

/**
 * Test-only substitution for the isolated, single-threaded WebAssembly inspection image.
 *
 * FileBasedIndexImpl.setUpFlusher() only creates IntelliJ's periodic background
 * index-flushing task. The inspection harness selects in-memory index storage,
 * whose storage implementations do not persist or flush data. Creating the
 * scheduled task nevertheless initializes AppScheduledExecutorService and tries
 * to start a Java worker thread, which WebImage does not support.
 *
 * Keep index loading, index initialization, PSI, and inspections untouched.
 * This substitution must never be included in a production plugin artifact.
 */
@TargetClass(className = "com.intellij.util.indexing.FileBasedIndexImpl")
final class TargetFileBasedIndexImplForWasmTest {
    @Substitute
    void setUpFlusher() {
        // In-memory indexes have no persistent state to flush.
    }
}
