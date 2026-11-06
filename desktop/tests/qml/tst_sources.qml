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

    SourcesTab {
        id: tab
        anchors.fill: parent
        client: fakeApi
        store: testStore
        curves: testCurves
    }

    function clone(v) { return JSON.parse(JSON.stringify(v)); }
    function strip(id) {
        for (var i = 0; i < tab.list.contentItem.children.length; ++i) {
            var c = tab.list.contentItem.children[i];
            if (c.objectName === "strip-" + id)
                return c;
        }
        return null;
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
        name: "Sources"
        when: windowShown

        function init() { testBridge.reset(); fakeApi.calls = []; tab.notice = ""; tab.detailId = ""; tab.dialog.close(); }

        function test_faderSendsWholeMixStage() {
            tryVerify(function () { return strip("src-2") !== null; });
            var fader = child(strip("src-2"), "fader-volume");
            verify(fader !== null);
            fader.moved(0.42);
            compare(fakeApi.calls.length, 1);
            compare(fakeApi.calls[0].method, "PUT");
            compare(fakeApi.calls[0].path, "/api/sources/src-2/processing/mix");
            var expected = clone(stateFixture.sources[1].processing.mix);
            expected.volume = 0.42;
            compare(JSON.stringify(fakeApi.calls[0].body), JSON.stringify(expected));
            compare(fader.confirmedValue, stateFixture.sources[1].processing.mix.volume, "affichage inchangé sans réponse de l'API");
        }

        function test_moogShowsGainNotQ() {
            var state = clone(stateFixture);
            state.sources[1].processing.lp.model = "MoogFF";
            testBridge.applyState(state);
            tab.detailId = "src-2";
            var lp = child(tab, "panel-lp");
            verify(lp !== null);
            tryVerify(function () { return lp.control("gain") !== null; });
            compare(lp.control("q"), null);
        }

        function test_dialogClosesWhenSourceDisappears() {
            tab.dialog.openFor(tab.sourceAt("src-2"));
            tryVerify(function () { return tab.dialog.opened; });
            var state = clone(stateFixture);
            state.sources.splice(1, 1);
            testBridge.applyState(state);
            tryVerify(function () { return !tab.dialog.opened; });
            verify(tab.notice.indexOf("src-2") >= 0, tab.notice);
        }

        function test_dialogShowsApiErrorAsReturned() {
            tab.dialog.openFor(null);
            tryVerify(function () { return tab.dialog.opened; });
            tab.dialog.submit();
            compare(fakeApi.calls[0].method, "POST");
            compare(fakeApi.calls[0].path, "/api/sources");
            fakeApi.requestFailed("POST", "/api/sources", "CHANNEL_OVERLAP", "Les canaux 2 à 3 sont déjà utilisés par src-2.");
            compare(tab.dialog.errorText, "Les canaux 2 à 3 sont déjà utilisés par src-2.");
            verify(tab.dialog.opened);
            fakeApi.responseReceived("POST", "/api/sources", {});
            tryVerify(function () { return !tab.dialog.opened; });
        }

        function test_sixtyFourSources() {
            var state = clone(stateFixture);
            var template = state.sources[0];
            state.sources = [];
            for (var i = 0; i < 64; ++i) {
                var s = clone(template);
                s.id = "src-" + (i + 1);
                s.name = "Source " + (i + 1);
                s.firstChannel = i + 1;
                state.sources.push(s);
            }
            testBridge.applyState(state);
            compare(tab.list.count, 64);
            tab.list.positionViewAtEnd();
            tryVerify(function () { return strip("src-64") !== null; });
            testBridge.applyEvent("sourceMeter", { sourceId: "src-64", peakDb: -6, rmsDb: -12 });
            compare(strip("src-64").peakDb, -6);
        }
    }
}
