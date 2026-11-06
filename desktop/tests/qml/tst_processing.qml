import QtQuick
import QtTest
import "../../qml/tabs"

Item {
    id: root
    width: 1800
    height: 900

    // Faux client : enregistre les appels ; GET processing-graph répond avec les chaînes produites par l'API.
    QtObject {
        id: fakeApi
        property var calls: []
        signal requestFailed(string method, string path, string code, string message)
        signal responseReceived(string method, string path, var body)
        function put(path, body) { calls.push({ method: "PUT", path: path, body: body }); }
        function post(path, body) { calls.push({ method: "POST", path: path, body: body }); }
        function patch(path, body) { calls.push({ method: "PATCH", path: path, body: body }); }
        function del(path) { calls.push({ method: "DELETE", path: path }); }
        function get(path) {
            calls.push({ method: "GET", path: path });
            var m = path.match(/^\/api\/(sources|outputs)\/([^/]+)\/processing-graph$/);
            if (m) {
                var chain = graphsFixture[m[1]][m[2]];
                if (chain)
                    responseReceived("GET", path, chain);
            }
        }
    }

    ProcessingTab {
        id: tab
        anchors.fill: parent
        client: fakeApi
        store: testStore
        curves: testCurves
    }

    function clone(v) { return JSON.parse(JSON.stringify(v)); }
    function child(item, name) {
        if (!item)
            return null;
        if (item.objectName === name)
            return item;
        for (var i = 0; i < item.children.length; ++i) {
            var found = child(item.children[i], name);
            if (found)
                return found;
        }
        return null;
    }
    function page() { return child(tab.workspace, "page-loader").item; }
    function puts() { return fakeApi.calls.filter(function (c) { return c.method === "PUT"; }); }

    TestCase {
        name: "Traitements"
        when: windowShown

        function init() {
            testBridge.reset();
            tab.show(stateFixture.sources[0].id);
            fakeApi.calls = [];
            tab.notice = "";
            tryVerify(function () { return tab.workspace.chain.length > 0; });
        }

        function test_firstSourceShownByDefault() {
            compare(tab.sourceId, stateFixture.sources[0].id);
            compare(tab.source.id, stateFixture.sources[0].id);
        }

        function test_chainFromApiInSignalOrder() {
            var chain = graphsFixture.sources[tab.sourceId];
            compare(tab.workspace.chain.length, chain.length);
            for (var i = 0; i < chain.length; ++i)
                verify(child(tab.workspace, "block-" + chain[i].stage) !== null, chain[i].stage);
            compare(tab.workspace.page, "input", "première page = premier étage");
        }

        function test_hpAndLpBlocksOpenFiltersPage() {
            mouseClick(child(tab.workspace, "block-lp"));
            compare(tab.workspace.page, "filters");
            mouseClick(child(tab.workspace, "block-hp"));
            compare(tab.workspace.page, "filters");
            verify(child(page(), "graph-filters") !== null, "graphe à côté des réglages");
            verify(child(page(), "panel-hp") !== null);
            verify(child(page(), "panel-lp") !== null);
        }

        function test_everyPageHasItsGraph() {
            var expected = { inputCompressor: "graph-transfer", eq: "graph-eq", filters: "graph-filters",
                             bandCompressor: "graph-crossover" };
            for (var p in expected) {
                tab.workspace.page = p;
                verify(child(page(), expected[p]) !== null, p);
            }
            tab.workspace.page = "mix";
            verify(child(page(), "indicator-stereo").visible);
            tab.workspace.page = "pitch";
            verify(child(page(), "indicator-pitch").visible);
        }

        function test_dragShowsPreviewThenConfirmedOnly() {
            tab.show("src-2");
            tryVerify(function () { return tab.workspace.chain.length > 0; });
            tab.workspace.page = "filters";
            var lp = child(page(), "panel-lp");
            var graph = child(page(), "graph-filters");
            var before = graph.series.length;
            lp.control("freq").previewChanged("freq", true, 0.3);
            compare(graph.series.length, before + 1, "courbe d\x27aperçu ajoutée");
            verify(graph.series[graph.series.length - 1].dashed);
            compare(puts().length, 0, "l\x27aperçu n\x27envoie rien");
            lp.control("freq").edited(0.3);
            compare(puts().length, 1);
            compare(puts()[0].path, "/api/sources/src-2/processing/lp");
            compare(puts()[0].body.freq, 0.3);
            compare(lp.value.freq, stateFixture.sources[1].processing.lp.freq, "affichage = état confirmé");
            lp.control("freq").previewChanged("freq", false, 0.3);
            compare(graph.series.length, before);
        }

        function test_moogShowsGainNotQ() {
            var state = clone(stateFixture);
            state.sources[1].processing.lp.model = "MoogFF";
            testBridge.applyState(state);
            tab.show("src-2");
            tab.workspace.page = "filters";
            var lp = child(page(), "panel-lp");
            tryVerify(function () { return lp.control("gain") !== null; });
            compare(lp.control("q"), null);
        }

        function test_mixFieldsFollowSourceWidth() {
            tab.workspace.page = "mix";
            var controls = child(page(), "stage-controls");
            verify(controls.control("panLevel") !== null, "largeur 1 : panLevel");
            compare(controls.control("spread"), null);
            tab.show("src-3");
            tab.workspace.page = "mix";
            controls = child(page(), "stage-controls");
            verify(controls.control("spread") !== null, "largeur 5 : spread");
            compare(controls.control("panLevel"), null);
        }

        function test_settingsChangeRefreshesChain() {
            var state = clone(stateFixture);
            state.sources[0].processing.hp.enabled = !state.sources[0].processing.hp.enabled;
            testBridge.applyState(state);
            tryVerify(function () {
                return fakeApi.calls.some(function (c) { return c.method === "GET" && c.path === "/api/sources/" + tab.sourceId + "/processing-graph"; });
            });
        }

        function test_meterDoesNotReplaceSource() {
            var before = tab.source;
            testBridge.applyEvent("sourceMeter", { sourceId: tab.sourceId, peakDb: -6, rmsDb: -12 });
            verify(tab.source === before, "un vumètre ne doit pas réaffecter la source affichée");
            compare(child(tab.workspace, "meter-source").rmsDb, -12);
        }

        function test_removedSourceFallsBackWithNotice() {
            tab.show("src-2");
            var state = clone(stateFixture);
            state.sources.splice(1, 1);
            testBridge.applyState(state);
            compare(tab.sourceId, state.sources[0].id);
            verify(tab.notice.indexOf("src-2") >= 0, tab.notice);
        }

        function test_outputWorkspace() {
            tab.showOutput("master");
            tryVerify(function () { return tab.workspace.chain.length === graphsFixture.outputs.master.length; });
            compare(tab.workspace.page, "infraHpf");
            verify(child(page(), "graph-highpass") !== null);
            var expected = { eq: "graph-eq", clipper: "graph-clipper", limiter: "graph-limiter", compressor: "graph-transfer" };
            for (var p in expected) {
                tab.workspace.page = p;
                verify(child(page(), expected[p]) !== null, p);
            }
        }

        function test_cueLimiterEnable() {
            tab.showOutput("cue");
            tryVerify(function () { return tab.workspace.chain.length > 0; });
            tab.workspace.page = "limiter";
            child(page(), "stage-controls").control("enabled").edited(true);
            compare(puts().length, 1);
            compare(puts()[0].path, "/api/outputs/cue/limiter");
            var expected = clone(stateFixture.outputs.cue.limiter);
            expected.enabled = true;
            compare(JSON.stringify(puts()[0].body), JSON.stringify(expected));
        }

        function test_unavailableModelIsDisabled() {
            verify(stateFixture.engine.models.FaustRMS === false, "la fixture publie FaustRMS indisponible");
            tab.showOutput("master");
            tryVerify(function () { return tab.workspace.chain.length > 0; });
            tab.workspace.page = "compressor";
            var option = child(page(), "option-FaustRMS");
            verify(option !== null);
            verify(!option.enabled, "FaustRMS désactivé");
            verify(child(page(), "option-Compander").enabled);
        }

        function test_outputMetersInGutter() {
            tab.showOutput("cue");
            testBridge.applyEvent("outputMeter", { output: "cue", channel: "right", peakDb: -3, rmsDb: -9 });
            compare(child(tab.workspace, "meter-right").rmsDb, -9);
            compare(child(tab.workspace, "meter-left").rmsDb, -120);
        }
    }
}
