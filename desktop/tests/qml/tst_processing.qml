import QtQuick
import QtTest
import "../../qml/tabs"

Item {
    id: root
    width: 1400
    height: 900

    QtObject {
        id: fakeApi
        property var calls: []
        signal requestFailed(string method, string path, string code, string message)
        signal responseReceived(string method, string path, var body)
        function put(path, body) { calls.push({ method: "PUT", path: path, body: body }); }
        function post(path, body) { calls.push({ method: "POST", path: path, body: body }); }
        function patch(path, body) { calls.push({ method: "PATCH", path: path, body: body }); }
        function del(path) { calls.push({ method: "DELETE", path: path }); }
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

    TestCase {
        name: "Processing"
        when: windowShown

        function init() { testBridge.reset(); fakeApi.calls = []; tab.sourceId = ""; tab.notice = ""; }

        function test_firstSourceShownByDefault() {
            compare(tab.sourceId, stateFixture.sources[0].id);
            compare(tab.source.id, stateFixture.sources[0].id);
        }

        function test_showSelectsSource() {
            tab.show("src-2");
            compare(tab.source.id, "src-2");
            compare(tab.notice, "");
        }

        function test_moogShowsGainNotQ() {
            var state = clone(stateFixture);
            state.sources[1].processing.lp.model = "MoogFF";
            testBridge.applyState(state);
            tab.show("src-2");
            var lp = child(tab, "panel-lp");
            verify(lp !== null);
            tryVerify(function () { return lp.control("gain") !== null; });
            compare(lp.control("q"), null);
        }

        function test_settingsFromApiUpdateView() {
            tab.show("src-2");
            var state = clone(stateFixture);
            state.sources[1].processing.lp.model = "MoogFF";
            testBridge.applyState(state);
            compare(tab.source.processing.lp.model, "MoogFF");
        }

        function test_meterDoesNotReplaceSource() {
            tab.show("src-2");
            var before = tab.source;
            testBridge.applyEvent("sourceMeter", { sourceId: "src-2", peakDb: -6, rmsDb: -12 });
            verify(tab.source === before, "un vumètre ne doit pas réaffecter la source affichée");
        }

        function test_removedSourceFallsBackWithNotice() {
            tab.show("src-2");
            var state = clone(stateFixture);
            state.sources.splice(1, 1);
            testBridge.applyState(state);
            compare(tab.sourceId, state.sources[0].id);
            verify(tab.notice.indexOf("src-2") >= 0, tab.notice);
        }

        function test_noSource() {
            var state = clone(stateFixture);
            state.sources = [];
            testBridge.applyState(state);
            compare(tab.sourceId, "");
            compare(tab.source, null);
        }
    }
}
