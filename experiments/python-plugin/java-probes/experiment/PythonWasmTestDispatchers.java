package experiment;

import com.oracle.svm.core.annotate.Alias;
import com.oracle.svm.core.annotate.Substitute;
import com.oracle.svm.core.annotate.TargetClass;
import kotlinx.coroutines.CoroutineDispatcher;
import kotlin.coroutines.CoroutineContext;
import java.util.ArrayDeque;

/**
 * Test-only Graal substitution for the isolated WebAssembly inspection harness.
 *
 * IntelliJ's index initialization uses Dispatchers.IO and coroutine work can also
 * reach Dispatchers.Default. Their thread-pool schedulers start worker threads, which
 * are unavailable in this single-threaded WASM runtime. Keep the real index
 * initializer and its tasks; only execute dispatched continuations synchronously on
 * the calling thread in this test image.
 *
 * This class must not be included in a production plugin artifact.
 */
@TargetClass(className = "com.oracle.svm.core.thread.JavaThreads")
final class TargetJavaThreadsForWasmTest {
    @Alias
    static native boolean isCurrentThreadVirtual();
}

@TargetClass(className = "kotlinx.coroutines.Dispatchers")
final class TargetDispatchersForWasmTest {
    @Substitute
    public static CoroutineDispatcher getIO() {
        Thread thread = Thread.currentThread();
        System.out.println("THREAD-DIAG:Dispatchers.IO getter thread=" + thread.getName()
                + " virtual=" + thread.isVirtual()
                + " svmVirtual=" + TargetJavaThreadsForWasmTest.isCurrentThreadVirtual());
        return CurrentThreadDispatcher.INSTANCE;
    }

    @Substitute
    public static CoroutineDispatcher getDefault() {
        Thread thread = Thread.currentThread();
        System.out.println("THREAD-DIAG:Dispatchers.Default getter thread=" + thread.getName()
                + " virtual=" + thread.isVirtual()
                + " svmVirtual=" + TargetJavaThreadsForWasmTest.isCurrentThreadVirtual());
        return CurrentThreadDispatcher.INSTANCE;
    }
}

final class CurrentThreadDispatcher extends CoroutineDispatcher {
    static final CurrentThreadDispatcher INSTANCE = new CurrentThreadDispatcher();

    private CurrentThreadDispatcher() {
    }

    @Override
    public boolean isDispatchNeeded(CoroutineContext context) {
        return false;
    }

    @Override
    public void dispatch(CoroutineContext context, Runnable block) {
        runOnCurrentThread(block);
    }

    static void runOnCurrentThread(Runnable block) {
        Thread thread = Thread.currentThread();
        System.out.println("THREAD-DIAG:coroutine dispatch thread=" + thread.getName()
                + " virtual=" + thread.isVirtual()
                + " svmVirtual=" + TargetJavaThreadsForWasmTest.isCurrentThreadVirtual());
        block.run();
    }

    @Override
    public CoroutineDispatcher limitedParallelism(int parallelism, String name) {
        if (parallelism < 1) {
            throw new IllegalArgumentException("parallelism must be positive");
        }
        return this;
    }

    @Override
    public String toString() {
        return "CurrentThreadDispatcher[WASM test harness]";
    }
}

/** Queues only one service's constructor-launched tasks until its registration completes. */
final class QueuedCurrentThreadDispatcher extends CoroutineDispatcher {
    private final ArrayDeque<Runnable> pending = new ArrayDeque<>();
    private boolean activated;

    @Override
    public synchronized boolean isDispatchNeeded(CoroutineContext context) {
        return !activated;
    }

    @Override
    public void dispatch(CoroutineContext context, Runnable block) {
        synchronized (this) {
            if (!activated) {
                pending.addLast(block);
                return;
            }
        }
        CurrentThreadDispatcher.runOnCurrentThread(block);
    }

    void activateQueuedTasks() {
        synchronized (this) {
            if (activated) {
                throw new IllegalStateException("WASM test dispatcher is already activated");
            }
            activated = true;
        }
        while (true) {
            Runnable next;
            synchronized (this) {
                next = pending.pollFirst();
            }
            if (next == null) {
                return;
            }
            CurrentThreadDispatcher.runOnCurrentThread(next);
        }
    }

    @Override
    public CoroutineDispatcher limitedParallelism(int parallelism, String name) {
        if (parallelism < 1) {
            throw new IllegalArgumentException("parallelism must be positive");
        }
        return this;
    }

    @Override
    public String toString() {
        return "QueuedCurrentThreadDispatcher[WASM test harness]";
    }
}
