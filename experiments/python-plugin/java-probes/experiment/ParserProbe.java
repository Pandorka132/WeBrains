package experiment;

import com.intellij.lang.ASTNode;
import com.intellij.mock.MockApplication;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.extensions.ExtensionPoint;
import com.intellij.openapi.util.Disposer;
import com.intellij.lang.ParserDefinition;
import com.intellij.lang.PsiBuilder;
import com.intellij.lang.impl.PsiBuilderFactoryImpl;
import com.intellij.lang.PsiParser;
import com.intellij.psi.TokenType;
import com.jetbrains.python.PyElementTypesFacade;
import java.util.ArrayList;
import java.util.List;

/** Runs the original Python CE parser through the real IntelliJ parser contracts. */
public final class ParserProbe {
    private static ParserDefinition createDefinition() throws Exception {
        return (ParserDefinition) Class.forName("com.jetbrains.python.PythonParserDefinition").getDeclaredConstructor().newInstance();
    }

    private ParserProbe() { }

    public static void main(String[] args) throws Exception {
        System.out.println("STAGE:disposer-before");
        var lifetime = Disposer.newDisposable("Python CE parser probe");
        System.out.println("STAGE:mock-application-before");
        var application = new MockApplication(lifetime);
        System.out.println("STAGE:mock-application-after");
        ApplicationManager.setApplication(application, lifetime);
        System.out.println("STAGE:application-set");
        var extensionArea = application.getExtensionArea();
        extensionArea.registerExtensionPoint("Pythonid.dialectsTokenSetContributor", "com.jetbrains.python.PythonDialectsTokenSetContributor", ExtensionPoint.Kind.INTERFACE, true);
        System.out.println("STAGE:extension-point-registered");
        var tokenSetContributors = extensionArea.<Object>getExtensionPoint("Pythonid.dialectsTokenSetContributor");
        for (String className : List.of(
            "com.jetbrains.python.PythonTokenSetContributor",
            "com.jetbrains.python.documentation.doctest.PyDoctestTokenSetContributor",
            "com.jetbrains.python.codeInsight.typeRepresentation.PyTypeRepresentationTokenSetContributor")) {
            tokenSetContributors.registerExtension(Class.forName(className).getDeclaredConstructor().newInstance());
        }
        application.registerService(PyElementTypesFacade.class, (PyElementTypesFacade) Class.forName("com.jetbrains.python.PyElementTypesFacadeImpl").getDeclaredConstructor().newInstance());
        System.out.println("STAGE:element-types-facade-registered");
        ParserDefinition definition = createDefinition();
        System.out.println("STAGE:parser-definition-created");
        String source = args.length == 0 ? "if True:\n    print(1)\n" : args[0];
        PsiBuilder builder = new PsiBuilderFactoryImpl().createBuilder(definition, definition.createLexer(null), source);
        definition.createParser(null).parse(definition.getFileNodeType(), builder);
        System.out.println("STAGE:parse-complete");
        ASTNode root = builder.getTreeBuilt();
        List<String> errors = new ArrayList<>();
        collect(root, source, errors);
        System.out.println("PARSER_JSON:[" + String.join(",", errors) + "]");
        System.out.println("PARSER_OK errors=" + errors.size());
    }

    private static void collect(ASTNode node, String source, List<String> errors) {
        if (node.getElementType() == TokenType.ERROR_ELEMENT) {
            if (source.isEmpty()) return;
            int start = Math.max(0, Math.min(node.getStartOffset(), source.length()));
            int end = Math.max(start, Math.min(start + node.getTextLength(), source.length()));
            if (end == start) {
                if (start == source.length()) start--;
                end = start + 1;
            }
            String error = String.format("{\"start\":%d,\"end\":%d,\"message\":\"Syntax error\"}", start, end);
            if (!errors.contains(error)) errors.add(error);
        }
        for (ASTNode child = node.getFirstChildNode(); child != null; child = child.getTreeNext()) collect(child, source, errors);
    }
}
