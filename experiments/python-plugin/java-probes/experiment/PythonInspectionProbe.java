package experiment;

import com.intellij.codeInspection.InspectionManager;
import com.intellij.codeInspection.LocalInspectionToolSession;
import com.intellij.codeInspection.ProblemsHolder;
import com.intellij.codeInspection.ex.InspectionManagerEx;
import com.intellij.core.CoreApplicationEnvironment;
import com.intellij.core.CoreProjectEnvironment;
import com.intellij.lang.ParserDefinition;
import com.intellij.lang.annotation.HighlightSeverity;
import com.intellij.mock.MockApplication;
import com.intellij.mock.MockProject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.extensions.ExtensionPoint;
import com.intellij.openapi.util.Disposer;
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

/** Runs the original Python CE unresolved-reference inspection against real Python PSI. */
public final class PythonInspectionProbe {
    private PythonInspectionProbe() { }

    public static void main(String[] args) throws Exception {
        String source = args.length == 0 ? "asd()\n" : args[0];
        // The standalone test has no IDE installation directory; production IDE launches set this property.
        System.setProperty("idea.home.path", "/");
        var lifetime = Disposer.newDisposable("Python CE inspection probe");
        var environment = new CoreApplicationEnvironment(lifetime, true);
        MockApplication application = environment.getApplication();
        ApplicationManager.setApplication(application, lifetime);

        var extensionArea = application.getExtensionArea();
        extensionArea.registerExtensionPoint("Pythonid.dialectsTokenSetContributor", "com.jetbrains.python.PythonDialectsTokenSetContributor", ExtensionPoint.Kind.INTERFACE, true);
        var contributors = extensionArea.<Object>getExtensionPoint("Pythonid.dialectsTokenSetContributor");
        for (String className : List.of(
                "com.jetbrains.python.PythonTokenSetContributor",
                "com.jetbrains.python.documentation.doctest.PyDoctestTokenSetContributor",
                "com.jetbrains.python.codeInsight.typeRepresentation.PyTypeRepresentationTokenSetContributor")) {
            contributors.registerExtension(Class.forName(className).getDeclaredConstructor().newInstance());
        }
        application.registerService(PyElementTypesFacade.class,
                (PyElementTypesFacade) Class.forName("com.jetbrains.python.PyElementTypesFacadeImpl").getDeclaredConstructor().newInstance());
        application.registerService(TypeEvalContextFactory.class, TypeEvalContextFactoryImpl.class);

        ParserDefinition parserDefinition = (ParserDefinition) Class.forName("com.jetbrains.python.PythonParserDefinition").getDeclaredConstructor().newInstance();
        environment.registerParserDefinition(parserDefinition);
        environment.registerFileType(PythonFileType.INSTANCE, "py");
        CoreProjectEnvironment projectEnvironment = new CoreProjectEnvironment(lifetime, environment);
        MockProject project = projectEnvironment.getProject();
        project.registerService(InspectionManager.class, InspectionManagerEx.class);

        PsiFile file = PsiFileFactory.getInstance(project).createFileFromText("probe.py", PythonFileType.INSTANCE, source);
        InspectionManager manager = InspectionManager.getInstance(project);
        ProblemsHolder holder = new ProblemsHolder(manager, file, true);
        var session = new LocalInspectionToolSession(file, new TextRange(0, source.length()),
                new TextRange(0, source.length()), HighlightSeverity.INFORMATION);
        PyUnresolvedReferencesInspection inspection = new PyUnresolvedReferencesInspection();
        inspection.inspectionStarted(session, true);
        PsiElementVisitor visitor = inspection.buildVisitor(holder, true, session);
        file.accept(visitor);
        inspection.inspectionFinished(session, holder);

        boolean unresolved = false;
        for (var problem : holder.getResults()) {
            String description = problem.getDescriptionTemplate();
            String text = problem.getPsiElement() == null ? "" : problem.getPsiElement().getText();
            System.out.println("INSPECTION_PROBLEM text=" + text + " description=" + description);
            if (text.equals("asd")) unresolved = true;
        }
        System.out.println("UNRESOLVED_REFERENCE_FOUND=" + unresolved);
        System.out.println("INSPECTION_PROBLEMS=" + holder.getResultCount());
        Disposer.dispose(lifetime);
    }
}
