import QtQuick
import QtTest
import "../../qml/tabs"

Item {
    width: 1400
    height: 900

    QtObject {
        id: fakeApi
        property var calls: []
        signal requestFailed(string method, string path, string code, string message)
        signal responseReceived(string method, string path, var body)
        function put(path, body) { calls.push({ method: "PUT", path: path, body: body }); }
        function post(path, body) { calls.push({ method: "POST", path: path, body: body }); }
        function get(path) { calls.push({ method: "GET", path: path }); }
    }

    OutputsTab {
        id: tab
        anchors.fill: parent
        client: fakeApi
        store: testStore
        curves: testCurves
    }

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

    TestCase {
        name: "Sorties"
        when: windowShown

        function init() { testBridge.reset(); fakeApi.calls = []; }

        function test_cueLimiterEnable() {
            var limiter = child(tab.cue, "stage-limiter");
            verify(limiter !== null);
            limiter.control("enabled").edited(true);
            compare(fakeApi.calls.length, 1);
            compare(fakeApi.calls[0].path, "/api/outputs/cue/limiter");
            var expected = JSON.parse(JSON.stringify(stateFixture.outputs.cue.limiter));
            expected.enabled = true;
            compare(JSON.stringify(fakeApi.calls[0].body), JSON.stringify(expected));
        }

        function test_unavailableModelIsDisabled() {
            verify(stateFixture.engine.models.FaustRMS === false, "la fixture publie FaustRMS indisponible");
            var compressor = child(tab.master, "stage-compressor");
            var option = child(compressor, "option-FaustRMS");
            verify(option !== null);
            verify(!option.enabled, "FaustRMS désactivé");
            verify(child(compressor, "option-Compander").enabled);
        }

        function test_outputMeterUpdatesCueRight() {
            testBridge.applyEvent("outputMeter", { output: "cue", channel: "right", peakDb: -3, rmsDb: -9 });
            compare(child(tab.cue, "meter-right").rmsDb, -9);
            compare(child(tab.cue, "meter-left").rmsDb, -120);
            compare(child(tab.master, "meter-right").rmsDb, -120);
        }

        function test_copyMasterAndGraph() {
            child(tab.cue, "button-copy-master").toggled(true);
            compare(fakeApi.calls[fakeApi.calls.length - 1].path, "/api/outputs/cue/copy-master");
            fakeApi.responseReceived("GET", "/api/outputs/master/processing-graph",
                                     [{ stage: "infraHpf", enabled: false, requestedModel: null, loadedModel: null }]);
            compare(tab.master.graph.length, 1);
            compare(tab.cue.graph.length, 0);
        }
    }
}
