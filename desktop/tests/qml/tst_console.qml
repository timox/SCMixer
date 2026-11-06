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

    ConsoleTab {
        id: tab
        anchors.fill: parent
        client: fakeApi
        store: testStore
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
        name: "Console"
        when: windowShown

        function init() { testBridge.reset(); fakeApi.calls = []; tab.notice = ""; tab.dialog.close(); }

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

        function test_processingButtonRequestsTab() {
            tryVerify(function () { return strip("src-2") !== null; });
            var spy = Qt.createQmlObject("import QtTest; SignalSpy { signalName: \"processingRequested\" }", root);
            spy.target = tab;
            child(strip("src-2"), "button-processing").toggled(true);
            compare(spy.count, 1);
            compare(spy.signalArguments[0][0], "src-2");
            compare(fakeApi.calls.length, 0);
        }

        function test_outputStripVolumeSendsWholeMixStage() {
            var strip = child(tab, "output-strip-master");
            verify(strip !== null);
            child(strip, "fader-output-volume").moved(0.6);
            compare(fakeApi.calls.length, 1);
            compare(fakeApi.calls[0].path, "/api/outputs/master/mix");
            var expected = clone(stateFixture.outputs.master.mix);
            expected.volume = 0.6;
            compare(JSON.stringify(fakeApi.calls[0].body), JSON.stringify(expected));
        }

        function test_outputStripsOpenProcessingAndCopy() {
            var spy = Qt.createQmlObject("import QtTest; SignalSpy { signalName: \"outputProcessingRequested\" }", root);
            spy.target = tab;
            child(child(tab, "output-strip-cue"), "button-processing").clicked();
            compare(spy.signalArguments[0][0], "cue");
            verify(!child(child(tab, "output-strip-master"), "button-copy-master").visible);
            child(child(tab, "output-strip-cue"), "button-copy-master").clicked();
            compare(fakeApi.calls[fakeApi.calls.length - 1].path, "/api/outputs/cue/copy-master");
        }

        function test_outputMeterUpdatesCueRight() {
            testBridge.applyEvent("outputMeter", { output: "cue", channel: "right", peakDb: -3, rmsDb: -9 });
            compare(child(child(tab, "output-strip-cue"), "meter-right").rmsDb, -9);
            compare(child(child(tab, "output-strip-cue"), "meter-left").rmsDb, -120);
            compare(child(child(tab, "output-strip-master"), "meter-right").rmsDb, -120);
        }

        function test_stripShowsEqGainInDb() {
            tryVerify(function () { return strip("src-1") !== null; });
            var low = child(strip("src-1"), "knob-eq-low");
            verify(low.valueText.indexOf("dB") > 0, low.valueText);
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
