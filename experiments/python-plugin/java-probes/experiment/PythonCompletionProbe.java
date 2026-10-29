package experiment;

import com.intellij.codeInsight.completion.CompletionContributor;
import com.intellij.codeInsight.TailTypeFactory;
import com.intellij.codeInsight.completion.FrontendFriendlyTailTypeFactory;
import com.intellij.codeInsight.completion.CompletionParameters;
import com.intellij.codeInsight.completion.CompletionProcess;
import com.intellij.codeInsight.completion.CompletionResult;
import com.intellij.codeInsight.completion.CompletionResultSet;
import com.intellij.codeInsight.completion.CompletionType;
import com.intellij.codeInsight.completion.CompletionSorter;
import com.intellij.codeInsight.completion.PrefixMatcher;
import com.intellij.codeInsight.completion.PlainPrefixMatcher;
import com.intellij.codeInsight.lookup.LookupElement;
import com.intellij.core.CoreApplicationEnvironment;
import com.intellij.core.CoreProjectEnvironment;
import com.intellij.lang.ParserDefinition;
import com.intellij.mock.MockApplication;
import com.intellij.mock.MockProject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.Editor;

import com.intellij.openapi.extensions.ExtensionPoint;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.util.registry.RegistryKeyBean;
import com.intellij.psi.PsiElement;
import com.intellij.psi.PsiFile;
import com.intellij.psi.PsiFileFactory;
import com.jetbrains.python.PyElementTypesFacade;
import com.jetbrains.python.PythonFileType;
import com.jetbrains.python.PythonLanguage;
import com.jetbrains.python.codeInsight.completion.PyKeywordCompletionContributor;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/** Invokes the original Python CE keyword CompletionContributor against real Python PSI. */
public final class PythonCompletionProbe {
    private PythonCompletionProbe() { }

    public static void main(String[] args) throws Exception {
        System.out.println("PROBE_STAGE=START");
        String source = args.length == 0 ? "if TruIntellijIdeaRulezzz" : args[0];
        int dummyOffset;
        if (args.length > 1) {
            int caretOffset = Math.max(0, Math.min(Integer.parseInt(args[1]), source.length()));
            source = source.substring(0, caretOffset) + "IntellijIdeaRulezzz" + source.substring(caretOffset);
            dummyOffset = caretOffset;
        } else {
            dummyOffset = source.indexOf("IntellijIdeaRulezzz");
        }
        // IntelliJ completion offset is the start of the dummy identifier, not EOF.
        int offset = dummyOffset >= 0 ? dummyOffset : source.length();
        System.setProperty("idea.home.path", "/");
        var lifetime = Disposer.newDisposable("Python CE completion probe");
        var environment = new CoreApplicationEnvironment(lifetime, true);
        System.out.println("PROBE_STAGE=CORE_ENVIRONMENT");
        MockApplication application = environment.getApplication();
        ApplicationManager.setApplication(application, lifetime);
        var area = application.getExtensionArea();
        area.registerExtensionPoint("Pythonid.dialectsTokenSetContributor", "com.jetbrains.python.PythonDialectsTokenSetContributor", ExtensionPoint.Kind.INTERFACE, true);
        var tokenContributors = area.<Object>getExtensionPoint("Pythonid.dialectsTokenSetContributor");
        for (String className : List.of(
                "com.jetbrains.python.PythonTokenSetContributor",
                "com.jetbrains.python.documentation.doctest.PyDoctestTokenSetContributor",
                "com.jetbrains.python.codeInsight.typeRepresentation.PyTypeRepresentationTokenSetContributor")) {
            tokenContributors.registerExtension(Class.forName(className).getDeclaredConstructor().newInstance());
        }
        application.registerService(com.jetbrains.python.PyLanguageFacade.class, com.jetbrains.python.PyLanguageFacadeImpl.class);
        application.registerService(PyElementTypesFacade.class,
                (PyElementTypesFacade) Class.forName("com.jetbrains.python.PyElementTypesFacadeImpl").getDeclaredConstructor().newInstance());
        CoreApplicationEnvironment.registerExtensionPoint(area, "com.intellij.registryKey", RegistryKeyBean.class);
        var registry = area.<RegistryKeyBean>getExtensionPoint("com.intellij.registryKey");
        var constructor = RegistryKeyBean.class.getDeclaredConstructor();
        constructor.setAccessible(true);
        for (String[] metadata : PythonRegistryKeys.ALL) {
            RegistryKeyBean bean = constructor.newInstance();
            bean.key = metadata[0]; bean.defaultValue = metadata[1]; bean.description = metadata[2];
            registry.registerExtension(bean, lifetime);
        }
        RegistryKeyBean.Companion.addKeysFromPlugins();
        application.registerService(TailTypeFactory.class, FrontendFriendlyTailTypeFactory.class);
        System.out.println("PROBE_STAGE=SERVICES_AND_REGISTRY");

        ParserDefinition parser = (ParserDefinition) Class.forName("com.jetbrains.python.PythonParserDefinition").getDeclaredConstructor().newInstance();
        environment.registerParserDefinition(parser);
        environment.registerFileType(PythonFileType.INSTANCE, "py");
        System.out.println("PROBE_STAGE=PARSER_REGISTERED");
        CoreProjectEnvironment projectEnvironment = new CoreProjectEnvironment(lifetime, environment);
        MockProject project = projectEnvironment.getProject();
        System.out.println("PROBE_STAGE=PROJECT_CREATED");
        PsiFile file = PsiFileFactory.getInstance(project).createFileFromText("probe.py", PythonLanguage.INSTANCE, source);
        System.out.println("PROBE_STAGE=PSI_FILE_CREATED");
        System.out.println("PROBE_STAGE=BEFORE_FIND_ELEMENT");
        PsiElement position = file.findElementAt(Math.min(offset, Math.max(0, source.length() - 1)));
        System.out.println("PROBE_STAGE=AFTER_FIND_ELEMENT");
        System.out.println("PROBE_STAGE=BEFORE_PROJECT_DISPOSED");
        System.out.println("PROJECT_DISPOSED=" + project.isDisposed());
        System.out.println("PROBE_STAGE=AFTER_PROJECT_DISPOSED");
        System.out.println("PROBE_STAGE=BEFORE_VIRTUAL_FILE_VALID");
        System.out.println("VIRTUAL_FILE_VALID=" + file.getVirtualFile().isValid());
        System.out.println("PROBE_STAGE=AFTER_VIRTUAL_FILE_VALID");
        System.out.println("PROBE_STAGE=BEFORE_FILE_IS_VALID");
        System.out.println("FILE_VALID=" + file.isValid());
        System.out.println("PROBE_STAGE=AFTER_FILE_IS_VALID");
        System.out.println("PROBE_STAGE=BEFORE_POSITION_NODE");
        var positionNode = position.getNode();
        System.out.println("POSITION_NODE=" + positionNode.getClass().getName());
        System.out.println("PROBE_STAGE=AFTER_POSITION_NODE");
        System.out.println("PROBE_STAGE=BEFORE_TREE_PARENT");
        System.out.println("TREE_PARENT=" + positionNode.getTreeParent().getClass().getName());
        System.out.println("PROBE_STAGE=AFTER_TREE_PARENT");
        System.out.println("PROBE_STAGE=BEFORE_TREE_ROOT_WALK");
        com.intellij.lang.ASTNode rootNode = positionNode;
        while (rootNode.getTreeParent() != null) rootNode = rootNode.getTreeParent();
        System.out.println("TREE_ROOT=" + rootNode.getClass().getName());
        System.out.println("PROBE_STAGE=AFTER_TREE_ROOT_WALK");
        System.out.println("PROBE_STAGE=BEFORE_PROGRESS_MANAGER_LOOKUP");
        com.intellij.openapi.progress.ProgressManager progressManager = com.intellij.openapi.progress.ProgressManager.getInstanceOrNull();
        System.out.println("PROGRESS_MANAGER=" + (progressManager == null ? "null" : progressManager.getClass().getName()));
        System.out.println("PROBE_STAGE=AFTER_PROGRESS_MANAGER_LOOKUP");
        System.out.println("PROBE_STAGE=BEFORE_CURRENT_JOB");
        kotlinx.coroutines.Job currentJob = com.intellij.openapi.progress.Cancellation.currentJob();
        System.out.println("CURRENT_JOB=" + (currentJob == null ? "null" : currentJob.getClass().getName()));
        System.out.println("PROBE_STAGE=AFTER_CURRENT_JOB");
        System.out.println("PROBE_STAGE=BEFORE_DEBUG_ATTACH_FLAG");
        boolean debugAttachFlag = com.intellij.util.DebugAttachDetectorArgs.isDebugEnabled();
        System.out.println("DEBUG_ATTACH_FLAG=" + debugAttachFlag);
        System.out.println("PROBE_STAGE=AFTER_DEBUG_ATTACH_FLAG");
        System.out.println("PROBE_STAGE=BEFORE_NON_CANCELABLE_CHECK");
        boolean nonCancelable = com.intellij.openapi.progress.Cancellation.isInNonCancelableSection(currentJob);
        System.out.println("NON_CANCELABLE=" + nonCancelable);
        System.out.println("PROBE_STAGE=AFTER_NON_CANCELABLE_CHECK");
        System.out.println("PROBE_STAGE=BEFORE_CHECK_CANCELED");
        com.intellij.openapi.progress.ProgressIndicatorProvider.checkCanceled();
        System.out.println("PROBE_STAGE=AFTER_CHECK_CANCELED");
        System.out.println("PROBE_STAGE=BEFORE_ROOT_PSI");
        System.out.println("ROOT_PSI=" + rootNode.getPsi().getClass().getName());
        System.out.println("PROBE_STAGE=AFTER_ROOT_PSI");
        System.out.println("PROBE_STAGE=BEFORE_POSITION_CONTAINING_FILE");
        System.out.println("POSITION_CONTAINING_FILE=" + position.getContainingFile().getClass().getName());
        System.out.println("PROBE_STAGE=AFTER_POSITION_CONTAINING_FILE");
        System.out.println("PROBE_STAGE=BEFORE_POSITION_IS_VALID");
        System.out.println("POSITION_VALID=" + position.isValid());
        System.out.println("PROBE_STAGE=AFTER_POSITION_IS_VALID");
        System.out.println("PROBE_STAGE=BEFORE_POSITION_TEXT_RANGE");
        System.out.println("POSITION_TEXT_RANGE=" + position.getTextRange());
        System.out.println("PROBE_STAGE=AFTER_POSITION_TEXT_RANGE");
        System.out.println("PROBE_STAGE=BEFORE_EDITOR_PROXY");
        Editor editor = (Editor) java.lang.reflect.Proxy.newProxyInstance(Editor.class.getClassLoader(), new Class<?>[]{Editor.class}, (proxy, method, arguments) -> {
            if (method.getName().equals("getProject")) return project;
            if (method.getName().equals("isDisposed")) return false;
            if (method.getReturnType() == boolean.class) return false;
            if (method.getReturnType() == int.class) return 0;
            if (method.getReturnType() == long.class) return 0L;
            if (method.getReturnType() == float.class) return 0f;
            if (method.getReturnType() == double.class) return 0d;
            return null;
        });
        System.out.println("PROBE_STAGE=AFTER_EDITOR_PROXY");
        CompletionProcess process = () -> false;
        System.out.println("PROBE_STAGE=BEFORE_PARAMETERS");
        CompletionParameters parameters = new CompletionParameters(position, file, CompletionType.BASIC, offset, 0, editor, process);
        System.out.println("PROBE_STAGE=AFTER_PARAMETERS");
        List<String> items = new ArrayList<>();
        var contributor = new PyKeywordCompletionContributor();
        var matcher = new PlainPrefixMatcher(source.substring(0, dummyOffset >= 0 ? dummyOffset : offset).replaceAll("(?s).*?([A-Za-z_]\\w*)$", "$1"));
        CompletionResultSet results = new CapturingResultSet(matcher, ignored -> { }, contributor, items);
        System.out.println("PROBE_STAGE=BEFORE_CONTRIBUTOR");
        contributor.fillCompletionVariants(parameters, results);
        System.out.println("PROBE_STAGE=AFTER_CONTRIBUTOR");
        System.out.println("OFFSET=" + offset + " POSITION=" + position + " POSITION_CLASS=" + position.getClass().getName());
        for (PsiElement e = position; e != null; e = e.getParent()) {
            System.out.println("PSI=" + e.getClass().getSimpleName() + " text=" + e.getText().replace("\n", "\\n"));
            if (e == file) break;
        }
        System.out.println("ORIGINAL_CONTRIBUTOR=" + contributor.getClass().getName());
        System.out.println("SOURCE=" + source);
        System.out.println("COMPLETION_ITEMS=" + items);
        System.out.println("COMPLETION_JSON=" + toJson(items));
        System.out.println("COMPLETION_COUNT=" + items.size());
        Disposer.dispose(lifetime);
    }

    private static String toJson(List<String> values) {
        StringBuilder json = new StringBuilder("[");
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) json.append(',');
            json.append('"');
            for (char character : values.get(i).toCharArray()) {
                switch (character) {
                    case '"' -> json.append("\\u0022");
                    case '\\' -> json.append("\\\\");
                    case '\n' -> json.append("\\n");
                    case '\r' -> json.append("\\r");
                    case '\t' -> json.append("\\t");
                    default -> json.append(character);
                }
            }
            json.append('"');
        }
        return json.append(']').toString();
    }

    private static final class CapturingResultSet extends CompletionResultSet {
        private final List<String> items;
        private PrefixMatcher matcher;
        CapturingResultSet(PrefixMatcher matcher, Consumer<? super CompletionResult> consumer,
                           CompletionContributor contributor, List<String> items) {
            super(matcher, consumer, contributor); this.matcher = matcher; this.items = items;
        }
        @Override public void addElement(LookupElement element) { if (matcher.prefixMatches(element)) items.add(element.getLookupString()); }
        @Override public CompletionResultSet withPrefixMatcher(PrefixMatcher matcher) { this.matcher = matcher; return this; }
        @Override public CompletionResultSet withPrefixMatcher(String prefix) { this.matcher = new PlainPrefixMatcher(prefix); return this; }
        @Override public CompletionResultSet withRelevanceSorter(CompletionSorter sorter) { return this; }
        @Override public void addLookupAdvertisement(String text) { }
        @Override public CompletionResultSet caseInsensitive() { return this; }
        @Override public void restartCompletionOnPrefixChange(com.intellij.patterns.ElementPattern<String> prefixCondition) { }
        @Override public void restartCompletionWhenNothingMatches() { }
        @Override public void restartCompletionOnAnyPrefixChange() { }
    }
}
