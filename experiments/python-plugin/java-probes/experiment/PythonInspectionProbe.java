package experiment;

import com.intellij.codeInspection.InspectionManager;
import com.intellij.codeInspection.LocalInspectionToolSession;
import com.intellij.codeInspection.ProblemsHolder;
import com.intellij.codeInspection.ex.InspectionManagerEx;
import com.intellij.core.CoreApplicationEnvironment;
import com.intellij.core.CoreProjectEnvironment;
import com.intellij.ide.plugins.PluginDescriptorLoader;
import com.intellij.lang.ParserDefinition;
import com.intellij.lang.annotation.HighlightSeverity;
import com.intellij.mock.MockApplication;
import com.intellij.mock.MockProject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.extensions.ExtensionPoint;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.util.registry.RegistryKeyBean;
import com.intellij.openapi.util.TextRange;
import com.intellij.psi.PsiElementVisitor;
import com.intellij.psi.PsiFile;
import com.intellij.psi.PsiFileFactory;
import com.jetbrains.python.PyElementTypesFacade;
import com.jetbrains.python.PythonFileType;
import com.jetbrains.python.psi.types.TypeEvalContextFactory;
import com.jetbrains.python.psi.types.TypeEvalContextFactoryImpl;
import com.jetbrains.python.inspections.unresolvedReference.PyUnresolvedReferencesInspection;
import java.util.List;
import java.nio.file.Path;

/** Runs the original Python CE unresolved-reference inspection against real Python PSI. */
public final class PythonInspectionProbe {
    private PythonInspectionProbe() { }

    /** MockProject omits ComponentManagerEx's suspend service lookup used by the workspace model. */
    private static final class AsyncServiceMockProject extends MockProject {
        AsyncServiceMockProject(org.picocontainer.PicoContainer container,
                                com.intellij.openapi.Disposable parentDisposable) {
            super(container, parentDisposable);
            // Match IntelliJ's own service descriptor for a light, module-less project.
            registerService(com.intellij.openapi.module.ModuleManager.class,
                    new com.intellij.openapi.module.EmptyModuleManager(this));
        }

        @Override
        public <T> Object getServiceAsync(Class<T> serviceClass,
                                          kotlin.coroutines.Continuation<? super T> continuation) {
            return getService(serviceClass);
        }
    }

    private static final String PLATFORM_INDEX_PLUGIN_XML = """
            <idea-plugin>
              <id>com.intellij</id>
              <name>IntelliJ Platform Indexes</name>
              <extensions defaultExtensionNs="com.intellij">
                <fileBasedIndexLayout id="in-memory" priority="0" presentableNameKey="ide.indexes.in-memory-storage.presentable.name" bundleName="messages.IndexingBundle" providerClass="com.intellij.util.indexing.memory.InMemoryStorageLayoutProvider" version="0" />
              </extensions>
            </idea-plugin>
            """;

    private static final String PYTHON_INDEX_PLUGIN_XML = """
            <idea-plugin>
              <id>PythonCore</id>
              <name>Python Community Edition Indexes</name>
              <extensions defaultExtensionNs="com.intellij">
                <stubIndex implementation="com.jetbrains.python.psi.stubs.PyClassNameIndex" />
                <stubIndex implementation="com.jetbrains.python.psi.stubs.PyClassNameIndexInsensitive" />
                <stubIndex implementation="com.jetbrains.python.psi.stubs.PyFunctionNameIndex" />
                <stubIndex implementation="com.jetbrains.python.psi.stubs.PySuperClassIndex" />
                <stubIndex implementation="com.jetbrains.python.psi.stubs.PyVariableNameIndex" />
                <stubIndex implementation="com.jetbrains.python.psi.stubs.PyDecoratorStubIndex" />
                <stubIndex implementation="com.jetbrains.python.psi.stubs.PyClassAttributesIndex" />
                <stubIndex implementation="com.jetbrains.python.psi.stubs.PyExportedModuleAttributeIndex" />
                <stubIndex implementation="com.jetbrains.python.psi.stubs.PyTypeAliasNameIndex" />
                <fileBasedIndex implementation="com.jetbrains.python.psi.stubs.PyModuleNameIndex" />
                <fileBasedIndex implementation="com.jetbrains.python.psi.stubs.PySetuptoolsNamespaceIndex" />
                <stubElementTypeHolder class="com.jetbrains.python.PyStubElementTypes" externalIdPrefix="py." />
              </extensions>
            </idea-plugin>
            """;

    private static void writePluginDescriptor(Path pluginDirectory, String descriptor) throws Exception {
        Path descriptorPath = pluginDirectory.resolve("META-INF/plugin.xml");
        java.nio.file.Files.createDirectories(descriptorPath.getParent());
        java.nio.file.Files.writeString(descriptorPath, descriptor);
    }

    private static boolean containsCoreVfsMismatch(Throwable failure) {
        if (failure instanceof ClassCastException) {
            String message = failure.getMessage();
            if (message != null && message.contains("CoreLocalFileSystem")
                    && message.contains("LocalFileSystem")) return true;
        }
        if (failure.getCause() != null && containsCoreVfsMismatch(failure.getCause())) return true;
        for (Throwable suppressed : failure.getSuppressed()) {
            if (containsCoreVfsMismatch(suppressed)) return true;
        }
        return false;
    }

    private static boolean isExpectedCoreVfsCleanupFailure(Throwable failure,
            com.intellij.openapi.vfs.newvfs.persistent.PersistentFSImpl persistentFs) {
        boolean expectedMessage = "VFS disconnect produced errors".equals(failure.getMessage())
                || (failure.getCause() != null
                    && "VFS disconnect produced errors".equals(failure.getCause().getMessage()));
        return expectedMessage && !persistentFs.isConnected() && containsCoreVfsMismatch(failure);
    }

    private static String jsonString(String value) {
        StringBuilder escaped = new StringBuilder(value.length() + 16);
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '\\' -> escaped.append("\\\\");
                case '"' -> escaped.append("\\\"");
                case '\n' -> escaped.append("\\n");
                case '\r' -> escaped.append("\\r");
                case '\t' -> escaped.append("\\t");
                default -> {
                    if (character < 0x20) escaped.append(String.format("\\u%04x", (int) character));
                    else escaped.append(character);
                }
            }
        }
        return escaped.toString();
    }

    public static void main(String[] args) throws Exception {
        String source = args.length == 0 ? "if Tru:\n    pass\n" : args[0];
        // The standalone test has no IDE installation directory; production IDE launches set this property.
        System.setProperty("idea.home.path", "/");
        Thread entryThread = Thread.currentThread();
        System.out.println("THREAD-DIAG:probe entry thread=" + entryThread.getName()
                + " virtual=" + entryThread.isVirtual()
                + " svmVirtual=" + TargetJavaThreadsForWasmTest.isCurrentThreadVirtual());
        // Enable IntelliJ in-memory FileBasedIndex storage before FileBasedIndex initializes.
        System.setProperty("idea.use.in.memory.file.based.index", "true");
        System.setProperty("idea.index.storage.forced.layout", "in-memory");
        System.setProperty("vfs.parallelize-initialization", "false");
        System.setProperty("vfs.flushing.use-background-flush", "false");
        com.intellij.openapi.vfs.newvfs.persistent.PersistentFSRecordsStorageFactory.setStorageImplementation(
                new com.intellij.openapi.vfs.newvfs.persistent.PersistentFSRecordsStorageFactory.InMemory());
        // The isolated WebAssembly probe runs all application work on one thread. Register
        // that thread through IntelliJ's own EDT API so MockApplication does not fall back
        // to java.awt.EventQueue, which is unavailable in the browser runtime.
        com.intellij.util.ui.EDT.updateEdt();
        var lifetime = Disposer.newDisposable("Python CE inspection probe");
        var environment = new CoreApplicationEnvironment(lifetime, true);
        MockApplication application = environment.getApplication();
        // CoreApplicationEnvironment already installs this application and registers its
        // lifetime cleanup. Re-registering it here would clear the global application
        // before the VFS child disposers run, breaking their extension-point lookups.
        // This is an application-scoped IntelliJ service (@Service(Level.APP)).
        application.registerService(com.intellij.openapi.wm.ex.ProjectFrameCapabilitiesService.class,
                new com.intellij.openapi.wm.ex.ProjectFrameCapabilitiesService());

        var extensionArea = application.getExtensionArea();
        extensionArea.registerExtensionPoint("com.intellij.stubIndex",
                "com.intellij.psi.stubs.StubIndexExtension", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint("com.intellij.fileBasedIndex",
                "com.intellij.util.indexing.FileBasedIndexExtension", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint("com.intellij.fileBasedIndexLayout",
                "com.intellij.util.indexing.storage.FileBasedIndexLayoutProviderBean", ExtensionPoint.Kind.BEAN_CLASS, true);
        extensionArea.registerExtensionPoint("com.intellij.stubElementTypeHolder",
                "com.intellij.psi.stubs.StubElementTypeHolderEP", ExtensionPoint.Kind.BEAN_CLASS, true);
        extensionArea.registerExtensionPoint("com.intellij.persistentFsConnectionListener",
                "com.intellij.openapi.vfs.newvfs.persistent.PersistentFsConnectionListener", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint("com.intellij.fileBasedIndexInfrastructureExtension",
                "com.intellij.util.indexing.FileBasedIndexInfrastructureExtension", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint("com.intellij.globalIndexFilter",
                "com.intellij.util.indexing.GlobalIndexFilter", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint("com.intellij.vfs.asyncListener",
                "com.intellij.openapi.vfs.AsyncFileListener", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint("com.intellij.workspaceModel.fileIndexContributor",
                "com.intellij.workspaceModel.core.fileIndex.WorkspaceFileIndexContributor", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint("com.intellij.customLibraryTable",
                "com.intellij.openapi.roots.libraries.CustomLibraryTableDescription", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint("com.intellij.additionalLibraryRootsProvider",
                "com.intellij.openapi.roots.AdditionalLibraryRootsProvider", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint("com.intellij.smartPointer.anchorProvider",
                "com.intellij.psi.impl.smartPointers.SmartPointerAnchorProvider", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint("Pythonid.dialectsTokenSetContributor", "com.jetbrains.python.PythonDialectsTokenSetContributor", ExtensionPoint.Kind.INTERFACE, true);
        var contributors = extensionArea.<Object>getExtensionPoint("Pythonid.dialectsTokenSetContributor");
        for (String className : List.of(
                "com.jetbrains.python.PythonTokenSetContributor",
                "com.jetbrains.python.documentation.doctest.PyDoctestTokenSetContributor",
                "com.jetbrains.python.codeInsight.typeRepresentation.PyTypeRepresentationTokenSetContributor")) {
            contributors.registerExtension(Class.forName(className).getDeclaredConstructor().newInstance());
        }
        extensionArea.registerExtensionPoint("Pythonid.pyReferenceResolveProvider",
                "com.jetbrains.python.psi.resolve.PyReferenceResolveProvider", ExtensionPoint.Kind.INTERFACE, true);
        // Declared by the original Python CE descriptor; the Java implementation is supplied
        // by the optional Java plugin and is intentionally absent from this Python-only image.
        extensionArea.registerExtensionPoint("Pythonid.importCandidateProvider",
                com.jetbrains.python.codeInsight.imports.PyImportCandidateProvider.class.getName(),
                ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint("Pythonid.inspectionExtension", "com.jetbrains.python.inspections.PyInspectionExtension", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint("Pythonid.unresolvedReferenceQuickFixProvider",
                "com.jetbrains.python.inspections.PyUnresolvedReferenceQuickFixProvider", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint("Pythonid.typeProvider", "com.jetbrains.python.psi.impl.PyTypeProvider", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint(com.intellij.psi.codeStyle.FileIndentOptionsProvider.EP_NAME.getName(),
                "com.intellij.psi.codeStyle.FileIndentOptionsProvider", ExtensionPoint.Kind.BEAN_CLASS, true);
        extensionArea.registerExtensionPoint(com.intellij.psi.codeStyle.FileTypeIndentOptionsProvider.EP_NAME.getName(),
                "com.intellij.psi.codeStyle.FileTypeIndentOptionsProvider", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint(com.intellij.psi.codeStyle.LanguageCodeStyleSettingsProvider.EP_NAME.getName(),
                "com.intellij.psi.codeStyle.LanguageCodeStyleSettingsProvider", ExtensionPoint.Kind.BEAN_CLASS, true);
        extensionArea.registerExtensionPoint(com.intellij.psi.codeStyle.CodeStyleSettingsProvider.EXTENSION_POINT_NAME.getName(),
                "com.intellij.psi.codeStyle.CodeStyleSettingsProvider", ExtensionPoint.Kind.BEAN_CLASS, true);
        extensionArea.registerExtensionPoint(com.intellij.psi.codeStyle.LanguageCodeStyleSettingsContributor.EP_NAME.getName(),
                "com.intellij.psi.codeStyle.LanguageCodeStyleSettingsContributor", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.getExtensionPoint(com.intellij.psi.codeStyle.LanguageCodeStyleSettingsProvider.EP_NAME.getName())
                .registerExtension(new com.jetbrains.python.formatter.PyLanguageCodeStyleSettingsProvider());
        extensionArea.registerExtensionPoint(com.intellij.psi.codeStyle.FileCodeStyleProvider.EP_NAME.getName(),
                "com.intellij.psi.codeStyle.FileCodeStyleProvider", ExtensionPoint.Kind.INTERFACE, true);
        extensionArea.registerExtensionPoint(com.intellij.psi.codeStyle.modifier.CodeStyleSettingsModifier.EP_NAME.getName(),
                "com.intellij.psi.codeStyle.modifier.CodeStyleSettingsModifier", ExtensionPoint.Kind.INTERFACE, true);

        Path platformIndexPlugin = Path.of("/tmp/webrains-platform-index-plugin");
        Path pythonIndexPlugin = Path.of("/tmp/webrains-python-index-plugin");
        writePluginDescriptor(platformIndexPlugin, PLATFORM_INDEX_PLUGIN_XML);
        writePluginDescriptor(pythonIndexPlugin, PYTHON_INDEX_PLUGIN_XML);
        CoreApplicationEnvironment.registerExtensionPointAndExtensions(
                platformIndexPlugin, "plugin.xml", extensionArea);
        CoreApplicationEnvironment.registerExtensionPointAndExtensions(
                pythonIndexPlugin, "plugin.xml", extensionArea);

        // Keep the extension point available even when optional providers are not linked into
        // this minimal WASM image. Core lexical/reference resolution can still run without them.
        // The default extension calls ScratchUtil, which requires the IDE scratch-file subsystem;
        // this standalone harness has no scratch registry. Keep the original inspection visitor but
        // omit this IDE-only policy extension from the isolated semantic test.
        // Inspection and type-provider extension points were registered before their providers above.
        application.registerService(PyElementTypesFacade.class,
                (PyElementTypesFacade) Class.forName("com.jetbrains.python.PyElementTypesFacadeImpl").getDeclaredConstructor().newInstance());
        application.registerService(com.jetbrains.python.PyLanguageFacade.class,
                (com.jetbrains.python.PyLanguageFacade) Class.forName("com.jetbrains.python.PyLanguageFacadeImpl").getDeclaredConstructor().newInstance());
        // CoreApplicationEnvironment does not run the IDE's registry bootstrap. Populate the real
        // IntelliJ Registry service with key descriptors extracted from the original Python CE
        // module descriptors; the inspection itself and its PSI/type APIs remain unmodified.
        var registryDescriptors = new java.util.HashMap<String, com.intellij.openapi.util.registry.RegistryKeyDescriptor>();
        for (String[] metadata : PythonRegistryKeys.ALL) {
            registryDescriptors.put(metadata[0], new com.intellij.openapi.util.registry.RegistryKeyDescriptor(
                    metadata[0], metadata[2], metadata[1], false, false, "PythonCore", "META-INF/plugin.xml"));
        }
        com.intellij.openapi.util.registry.Registry.Companion.setContributedKeys(java.util.Map.copyOf(registryDescriptors));
        var probeCoroutineScope = kotlinx.coroutines.CoroutineScopeKt.CoroutineScope(kotlin.coroutines.EmptyCoroutineContext.INSTANCE);
        application.registerService(kotlinx.coroutines.CoroutineScope.class, probeCoroutineScope);

        application.registerService(com.intellij.openapi.vfs.LocalFileSystem.class,
                com.intellij.openapi.vfs.impl.local.LocalFileSystemImpl.class);
        application.registerService(com.intellij.openapi.vfs.newvfs.ManagingFS.class,
                com.intellij.openapi.vfs.newvfs.persistent.PersistentFSImpl.class);
        System.out.println("STAGE:managing-fs="
                + com.intellij.openapi.vfs.newvfs.ManagingFS.getInstance().getClass().getName());

        application.registerService(
                com.intellij.internal.statistic.eventLog.validator.storage.persistence.EventLogMetadataSettingsPersistence.class,
                new com.intellij.internal.statistic.eventLog.validator.storage.persistence.EventLogMetadataSettingsPersistence());
        application.registerService(com.intellij.openapi.application.AsyncExecutionService.class,
                com.intellij.openapi.application.impl.AsyncExecutionServiceImpl.class);
        application.registerService(com.intellij.psi.stubs.StubUpdatableIndexFactory.class,
                com.intellij.psi.stubs.StubUpdatableIndexFactoryImpl.class);
        @SuppressWarnings("unchecked")
        Class<? extends com.intellij.psi.stubs.StubTreeLoader> stubTreeLoaderImpl =
                (Class<? extends com.intellij.psi.stubs.StubTreeLoader>) Class.forName("com.intellij.psi.stubs.StubTreeLoaderImpl");
        application.registerService(com.intellij.psi.stubs.StubTreeLoader.class, stubTreeLoaderImpl);

        var serializationManager = new com.intellij.psi.stubs.SerializationManagerImpl(probeCoroutineScope);
        application.registerService(com.intellij.psi.stubs.SerializationManagerEx.class, serializationManager, lifetime);
        serializationManager.initialize();

        var fileIndexExtensions = extensionArea.<com.intellij.util.indexing.FileBasedIndexExtension<?, ?>>getExtensionPoint(
                "com.intellij.fileBasedIndex");
        var stubUpdatingIndex = new com.intellij.psi.stubs.StubUpdatingIndex(
                com.intellij.psi.stubs.StubForwardIndexExternalizer.getIdeUsedExternalizer(), serializationManager);
        fileIndexExtensions.registerExtension(stubUpdatingIndex, lifetime);

        var fileIndex = new com.intellij.util.indexing.FileBasedIndexImpl(probeCoroutineScope);
        application.registerService(com.intellij.util.indexing.FileBasedIndex.class, fileIndex, lifetime);
        var changedFilesCollector = new com.intellij.util.indexing.events.ChangedFilesCollector(probeCoroutineScope);
        extensionArea.getExtensionPoint("com.intellij.vfs.asyncListener").registerExtension(changedFilesCollector, lifetime);
        var stubIndex = new com.intellij.psi.stubs.StubIndexImpl();
        application.registerService(com.intellij.psi.stubs.StubIndex.class, stubIndex, lifetime);

        System.out.println("STAGE:in-memory-index=" + com.intellij.util.indexing.FileBasedIndex.USE_IN_MEMORY_INDEX);
        System.out.println("STAGE:index-layout-forced=" + com.intellij.util.indexing.impl.storage.IndexStorageLayoutLocator.getCustomLayoutId());
        for (var layoutProvider : com.intellij.util.indexing.impl.storage.IndexStorageLayoutLocator.INSTANCE.getSupportedLayoutProviders()) {
            System.out.println("STAGE:index-layout-provider=" + layoutProvider.id
                    + ",priority=" + layoutProvider.priority + ",class=" + layoutProvider.providerClass);
        }
        for (var indexExtension : fileIndexExtensions.getExtensionList()) {
            var selectedLayout = com.intellij.util.indexing.impl.storage.IndexStorageLayoutLocator.getLayout(indexExtension);
            System.out.println("STAGE:index-layout-selection="
                    + indexExtension.getClass().getName() + ",layout=" + selectedLayout.getClass().getName());
        }
        System.out.println("STAGE:file-index-load-start");
        fileIndex.loadIndexes();
        System.out.println("STAGE:file-index-load-complete");
        fileIndex.waitUntilIndicesAreInitialized();
        System.out.println("STAGE:file-index-initialized");
        stubIndex.waitUntilStubIndexedInitialized();
        System.out.println("STAGE:real-stub-index-initialized count="
                + extensionArea.<com.intellij.psi.stubs.StubIndexExtension<?, ?>>getExtensionPoint("com.intellij.stubIndex")
                        .getExtensionList().size());

        Class<?> languageCodeStyleServiceClass = Class.forName(
                "com.intellij.psi.codeStyle.LanguageCodeStyleSettingsProviderService");
        var languageCodeStyleServiceConstructor = languageCodeStyleServiceClass.getDeclaredConstructor(
                kotlinx.coroutines.CoroutineScope.class);
        languageCodeStyleServiceConstructor.setAccessible(true);
        Object languageCodeStyleService = languageCodeStyleServiceConstructor.newInstance(probeCoroutineScope);
        application.registerService((Class) languageCodeStyleServiceClass, languageCodeStyleService);
        application.registerService(com.intellij.openapi.application.CoroutineSupport.class,
                new com.intellij.openapi.application.impl.PlatformCoroutineSupport());
        var pathMacros = new com.intellij.application.options.PathMacrosImpl(false);
        pathMacros.setMacro("ROOT_CONFIG", System.getProperty("idea.config.path", "/tmp/webrains-idea-config"));
        application.registerService(com.intellij.openapi.application.PathMacros.class, pathMacros);
        application.registerService(com.intellij.application.options.PathMacrosImpl.class, pathMacros);
        application.registerService(com.intellij.openapi.components.PathMacroManager.class,
                new com.intellij.configurationStore.ApplicationPathMacroManager());
        var applicationStore = new com.intellij.configurationStore.ApplicationStoreImpl(application);
        application.registerService(com.intellij.openapi.components.impl.stores.IComponentStore.class, applicationStore);
        applicationStore.setPath(java.nio.file.Path.of(System.getProperty("idea.config.path", "/tmp/webrains-idea-config")));
        application.registerService(com.intellij.psi.codeStyle.CodeStyleSettingsService.class,
                new com.intellij.psi.codeStyle.CodeStyleSettingsServiceImpl());
        application.registerService(com.intellij.psi.codeStyle.AppCodeStyleSettingsManager.class,
                new com.intellij.psi.codeStyle.AppCodeStyleSettingsManager());
        application.registerService(com.intellij.openapi.options.SchemeManagerFactory.class,
                new com.intellij.configurationStore.schemeManager.ApplicationSchemeManagerFactory(probeCoroutineScope));
        application.registerService(com.intellij.psi.codeStyle.CodeStyleSchemes.class,
                new com.intellij.psi.impl.source.codeStyle.PersistableCodeStyleSchemes());
        application.registerService(TypeEvalContextFactory.class, TypeEvalContextFactoryImpl.class);
        // The real Python PSI reference implementation consults this application service even
        // for ordinary source files; CoreApplicationEnvironment does not load plugin services.
        application.registerService(com.jetbrains.python.PythonRuntimeService.class,
                new com.jetbrains.python.PythonRuntimeServiceImpl());
        application.registerService(com.jetbrains.python.codeInsight.imports.PyImportCollectorFactory.class,
                new com.jetbrains.python.codeInsight.imports.CodeStylePyImportCollectorFactory());
        application.registerService(com.jetbrains.python.codeInsight.PyCodeInsightSettings.class,
                new com.jetbrains.python.codeInsight.PyCodeInsightSettings());

        ParserDefinition parserDefinition = (ParserDefinition) Class.forName("com.jetbrains.python.PythonParserDefinition").getDeclaredConstructor().newInstance();
        environment.registerParserDefinition(parserDefinition);
        // The isolated probe resets the application context after CoreApplicationEnvironment
        // construction, which leaves FileTypeRegistry on its empty fallback supplier. Install
        // the same platform CoreFileTypeRegistry implementation explicitly for this context.
        var coreFileTypeRegistry = new com.intellij.core.CoreFileTypeRegistry();
        coreFileTypeRegistry.registerFileType(PythonFileType.INSTANCE, "py");
        com.intellij.openapi.fileTypes.FileTypeRegistry.setInstanceSupplier(() -> coreFileTypeRegistry, lifetime);
        CoreProjectEnvironment projectEnvironment = new CoreProjectEnvironment(lifetime, environment) {
            @Override
            protected MockProject createProject(org.picocontainer.PicoContainer container,
                                                com.intellij.openapi.Disposable parentDisposable) {
                return new AsyncServiceMockProject(container, parentDisposable);
            }
        };
        MockProject project = projectEnvironment.getProject();
        // Expose the project through its interface key for Pico constructor injection,
        // as the full IDE component container does.
        if (project.getPicoContainer().getComponentAdapter(com.intellij.openapi.project.Project.class.getName()) == null) {
            project.registerService(com.intellij.openapi.project.Project.class, project);
        }
        // These are IntelliJ's declared headless project services, not test doubles:
        // the real IDE descriptor selects TestEditorManagerImpl in headless mode.
        project.registerService(com.intellij.openapi.fileEditor.FileEditorManager.class,
                new com.intellij.openapi.fileEditor.impl.TestEditorManagerImpl(project));
        project.getExtensionArea().registerExtensionPoint(
                com.intellij.openapi.roots.impl.DirectoryIndexExcludePolicy.EP_NAME,
                "com.intellij.openapi.roots.impl.DirectoryIndexExcludePolicy", ExtensionPoint.Kind.INTERFACE, lifetime);
        project.registerService(InspectionManager.class, InspectionManagerEx.class);
        project.registerService(com.intellij.psi.codeStyle.ProjectCodeStyleSettingsManager.class,
                new com.intellij.psi.codeStyle.ProjectCodeStyleSettingsManager(project));
        Class<?> codeStyleCachedValueServiceClass = Class.forName(
                "com.intellij.application.options.codeStyle.cache.CodeStyleCachedValueProviderService");
        var codeStyleCachedValueServiceConstructor = codeStyleCachedValueServiceClass.getDeclaredConstructor(
                kotlinx.coroutines.CoroutineScope.class);
        codeStyleCachedValueServiceConstructor.setAccessible(true);
        project.registerService((Class) codeStyleCachedValueServiceClass,
                codeStyleCachedValueServiceConstructor.newInstance(probeCoroutineScope));
        project.registerService(com.intellij.application.options.codeStyle.cache.TooFrequentCodeStyleComputationWatcher.class,
                new com.intellij.application.options.codeStyle.cache.TooFrequentCodeStyleComputationWatcher(project));
        project.registerService(com.intellij.application.options.codeStyle.cache.CodeStyleCachingService.class,
                new com.intellij.application.options.codeStyle.cache.CodeStyleCachingServiceImpl(project));
        project.registerService(com.intellij.workspaceModel.ide.JpsProjectLoadingManager.class,
                new com.intellij.workspaceModel.ide.impl.JpsProjectLoadingManagerImpl());
        // ProjectFileIndexImpl queries WorkspaceFileIndex. Register the lower-level
        // workspace index first, then construct the original project/root services.
        project.registerService(com.intellij.workspaceModel.core.fileIndex.WorkspaceFileIndex.class,
                new com.intellij.workspaceModel.core.fileIndex.impl.WorkspaceFileIndexImpl(project,
                        com.intellij.workspaceModel.core.fileIndex.impl.EmptyWorkspaceFileIndexData.Companion.getRESET()));
        project.registerService(com.intellij.openapi.roots.impl.DirectoryIndex.class,
                new com.intellij.openapi.roots.impl.DirectoryIndexImpl(project));
        project.registerService(com.intellij.openapi.roots.ProjectFileIndex.class,
                new com.intellij.openapi.roots.impl.ProjectFileIndexImpl(project));
        project.registerService(com.intellij.openapi.roots.ProjectRootManager.class,
                new com.intellij.openapi.roots.impl.ProjectRootManagerImpl(project, probeCoroutineScope));
        // CoreProjectEnvironment intentionally omits the IDE workspace model. The original
        // inspection queries WorkspaceModel through project services while calculating roots;
        // provide the platform implementation rather than a fake service or a custom resolver.
        application.registerService(com.intellij.workspaceModel.ide.legacyBridge.GlobalSdkTableBridgeRegistry.class,
                new com.intellij.workspaceModel.ide.impl.legacyBridge.sdk.GlobalSdkTableBridgeRegistryImpl());
        var libraryTablesRegistrarConstructor = Class.forName(
                "com.intellij.openapi.roots.impl.libraries.LibraryTablesRegistrarImpl").getDeclaredConstructor();
        libraryTablesRegistrarConstructor.setAccessible(true);
        application.registerService(com.intellij.openapi.roots.libraries.LibraryTablesRegistrar.class,
                (com.intellij.openapi.roots.libraries.LibraryTablesRegistrar) libraryTablesRegistrarConstructor.newInstance());
        application.registerService(com.intellij.workspaceModel.ide.JpsGlobalModelSynchronizer.class,
                new com.intellij.workspaceModel.ide.impl.jps.serialization.JpsGlobalModelSynchronizerImpl(probeCoroutineScope));
        var workspaceModel = new com.intellij.workspaceModel.ide.impl.WorkspaceModelImpl(project, probeCoroutineScope);
        project.registerService(com.intellij.platform.backend.workspace.WorkspaceModel.class, workspaceModel);
        // Register the original project services before ModuleManager starts workspace-model
        // listeners: those listeners can request Python's project model asynchronously.
        project.registerService(com.intellij.workspaceModel.ide.ProjectSynchronizerUtil.class,
                new com.intellij.workspaceModel.ide.impl.jps.serialization.ProjectSynchronizerUtilImpl(project));
        Class<?> cacheImplementation = Class.forName("com.jetbrains.python.psi.types.TypeEvalContextCacheImpl");
        var cacheConstructor = cacheImplementation.getDeclaredConstructor(com.intellij.openapi.project.Project.class);
        cacheConstructor.setAccessible(true);
        var typeEvalCache = (com.jetbrains.python.psi.types.TypeEvalContextCache) cacheConstructor.newInstance(project);
        project.registerService(com.jetbrains.python.psi.types.TypeEvalContextCache.class, typeEvalCache);
        project.registerService(com.jetbrains.python.psi.types.PyTypeEngineSettingsModificationTracker.class,
                new com.jetbrains.python.psi.types.PyTypeEngineSettingsModificationTracker());
        // The original service launches coroutines from its constructor. Defer those tasks
        // until the service instance is registered, then execute them on the WASM main thread.
        var evoDispatcher = new QueuedCurrentThreadDispatcher();
        var evoScope = kotlinx.coroutines.CoroutineScopeKt.CoroutineScope(evoDispatcher);
        var evoPyProjectModel = new com.intellij.python.pyproject.model.evolution.EvoPyProjectModel(
                project, evoScope);
        project.registerService(com.intellij.python.pyproject.model.evolution.EvoPyProjectModel.class,
                evoPyProjectModel);
        evoDispatcher.activateQueuedTasks();
        // This @Service(PROJECT) is not bootstrapped by CoreProjectEnvironment. Its original
        // implementation is safe to construct here; non-welcome-screen projects skip tracking.
        project.registerService(com.intellij.python.externalIndex.PyExternalFilesIndexService.class,
                new com.intellij.python.externalIndex.PyExternalFilesIndexService(project, project.getCoroutineScope()));
        // CoreProjectEnvironment does not load project services from the IDE plugin descriptor.
        // Use the platform's real Workspace Model-backed ModuleManager and its required listener.
        project.registerService(com.intellij.workspaceModel.ide.impl.legacyBridge.facet.FacetEntityChangeListener.class,
                new com.intellij.workspaceModel.ide.impl.legacyBridge.facet.FacetEntityChangeListener(project));
        // MockComponentManager supports class-backed service replacement by key; this removes
        // its initial EmptyModuleManager adapter and installs the original lazy IDE bridge.
        project.getPicoContainer().unregisterComponent(com.intellij.openapi.module.ModuleManager.class.getName());
        project.registerService(com.intellij.openapi.module.ModuleManager.class,
                new com.intellij.workspaceModel.ide.impl.legacyBridge.module.ModuleManagerComponentBridge(
                        project, probeCoroutineScope));

        // Use a real local VFS file rather than LightVirtualFile: canonical import-path
        // calculation walks containing directories and project roots in the original
        // Python inspection. A LightVirtualFile has no parent directory and cannot
        // reproduce that part of the IDE project model.
        var probeDirectory = java.nio.file.Files.createTempDirectory("python-ce-inspection-");
        var probePath = probeDirectory.resolve("probe.py");
        java.nio.file.Files.writeString(probePath, source);
        var virtualFile = environment.getLocalFileSystem().refreshAndFindFileByPath(probePath.toString());
        if (virtualFile == null) throw new IllegalStateException("Python probe file was not found in the local VFS");
        var psiManager = com.intellij.psi.PsiManager.getInstance(project);
        PsiFile file;
        try {
            file = psiManager.findFile(virtualFile);
        } catch (Throwable psiFailure) {
            return;
        }
        if (file == null) throw new IllegalStateException("Python PSI was not created for the virtual test file");
        for (var child : file.getChildren()) System.out.println("DEBUG_PSI_CHILD=" + child.getClass().getName() + " text=" + child.getText());
        InspectionManager manager = InspectionManager.getInstance(project);
        ProblemsHolder holder = new ProblemsHolder(manager, file, true);
        var session = new LocalInspectionToolSession(file, new TextRange(0, source.length()),
                new TextRange(0, source.length()), HighlightSeverity.INFORMATION);
        file.accept(new com.intellij.psi.PsiRecursiveElementWalkingVisitor() {
            @Override public void visitElement(com.intellij.psi.PsiElement element) {
                if (element instanceof com.jetbrains.python.psi.PyReferenceOwner owner) {
                    try {
                        var reference = owner.getReference(com.jetbrains.python.psi.resolve.PyResolveContext.defaultContext(
                                com.jetbrains.python.psi.types.TypeEvalContext.codeAnalysis(project, file)));
                        System.out.println("DEBUG_REFERENCE_OWNER=" + element.getClass().getName() + " text=" + element.getText()
                                + " ref=" + reference + " resolved=" + (reference == null ? "null" : reference.resolve()));
                        if (reference != null) {
                            try {
                            } catch (Throwable canonicalFailure) {
                                canonicalFailure.printStackTrace(System.out);
                            }
                        }
                        if (reference instanceof com.jetbrains.python.psi.PsiReferenceEx extendedReference) {
                            try {
                            } catch (Throwable severityFailure) {
                                severityFailure.printStackTrace(System.out);
                            }
                        }
                        if (reference instanceof com.intellij.psi.PsiPolyVariantReference polyReference) {
                        }
                    } catch (Throwable failure) {
                        System.out.println("DEBUG_REFERENCE_RESOLVE_FAILED=" + element.getText());
                        failure.printStackTrace(System.out);
                        throw failure;
                    }
                }
                super.visitElement(element);
            }
        });
        try {
        } catch (Throwable extensionFailure) {
            extensionFailure.printStackTrace(System.out);
        }
        try {
            var referenceElement = file.findElementAt(Math.max(0, source.indexOf("Tru")));
        } catch (Throwable failure) {
            failure.printStackTrace(System.out);
        }
        PyUnresolvedReferencesInspection inspection = new PyUnresolvedReferencesInspection();
        inspection.inspectionStarted(session, true);
        PsiElementVisitor visitor = inspection.buildVisitor(holder, true, session);
        // InspectionEngine normally walks the PSI tree and invokes the visitor for every element.
        // A plain file.accept(visitor) only visits the file root in this standalone harness.
        file.accept(new com.intellij.psi.PsiRecursiveElementWalkingVisitor() {
            @Override
            public void visitElement(com.intellij.psi.PsiElement element) {
                try {
                    element.accept(visitor);
                } catch (Throwable failure) {
                    failure.printStackTrace(System.out);
                    throw failure;
                }
                super.visitElement(element);
            }
        });
        inspection.inspectionFinished(session, holder);

        boolean unresolved = false;
        StringBuilder diagnosticsJson = new StringBuilder("[");
        boolean firstDiagnostic = true;
        for (var problem : holder.getResults()) {
            String description = problem.getDescriptionTemplate();
            var problemElement = problem.getPsiElement();
            String text = problemElement == null ? "" : problemElement.getText();
            System.out.println("INSPECTION_PROBLEM text=" + text + " description=" + description);
            if (text.equals("Tru")) unresolved = true;
            if (problemElement == null) continue;
            var range = problemElement.getTextRange();
            if (!firstDiagnostic) diagnosticsJson.append(',');
            firstDiagnostic = false;
            diagnosticsJson.append("{\"startOffset\":").append(range.getStartOffset())
                    .append(",\"endOffset\":").append(range.getEndOffset())
                    .append(",\"message\":\"").append(jsonString(description)).append("\"}");
        }
        diagnosticsJson.append(']');
        System.out.println("INSPECTION_JSON:" + diagnosticsJson);
        System.out.println("UNRESOLVED_REFERENCE_FOUND=" + unresolved);
        System.out.println("INSPECTION_PROBLEMS=" + holder.getResultCount());
        // PersistentFSImpl disconnects through application extension points. Disconnect it
        // while CoreApplicationEnvironment's application is still installed; the shared
        // lifetime also owns the application binding and may dispose it before VFS children.
        var persistentFs = (com.intellij.openapi.vfs.newvfs.persistent.PersistentFSImpl)
                application.getService(com.intellij.openapi.vfs.newvfs.ManagingFS.class);
        try {
            persistentFs.disconnect();
            Disposer.dispose(lifetime);
        } catch (RuntimeException | AssertionError cleanupFailure) {
            // Web Image surfaces the disposer aggregate as AssertionError, with the original
            // RuntimeException and CoreLocalFileSystem cast failure nested underneath it.
            // Ignore only this exact CoreApplicationEnvironment teardown mismatch, and only
            // after PersistentFSImpl confirms that its connection is already closed.
            if (!isExpectedCoreVfsCleanupFailure(cleanupFailure, persistentFs)) throw cleanupFailure;
            System.out.println("TEST_HARNESS_CLEANUP: ignored CoreApplicationEnvironment VFS hook mismatch after disconnect; connected="
                    + persistentFs.isConnected());
        }
    }
}
