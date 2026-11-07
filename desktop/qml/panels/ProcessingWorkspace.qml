import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../controls"
import "../graphs"
import "pages"
import "../controls/Theme.js" as Theme

// Traitements d'une source ou d'une sortie : bandeau de la chaîne (GET …/processing-graph, relu à chaque
// changement de réglages), puis la page de l'étage choisi (graphe et réglages côte à côte), et les
// vumètres en gouttière. Les pages HP et LP d'une source sont réunies (« filters »).
Item {
    id: ws
    property var client: null
    property var store: null
    property var curves: null
    property string scope: "source"
    property string target: ""
    property var source: null
    // Mesures de la source, fournies à part : les réglages (source) ne changent pas à chaque mesure.
    property var sourceMeter: ({ peakDb: -120, rmsDb: -120 })
    property string page: ""
    property var chain: []
    property bool showChainResponse: true

    readonly property var parameters: store ? store.parameters : ({})
    readonly property bool isSource: scope === "source"
    readonly property var output: !isSource && store ? (target === "master" ? store.master : store.cue) : ({})
    readonly property var processing: isSource ? (source ? source.processing : ({})) : output
    readonly property string base: isSource ? "/api/sources/" + target + "/processing/" : "/api/outputs/" + target + "/"
    readonly property string graphPath: isSource ? "/api/sources/" + target + "/processing-graph" : "/api/outputs/" + target + "/processing-graph"
    readonly property var context: isSource && source ? { width: source.width } : ({})
    readonly property real sampleRate: store && store.runtime && store.runtime.sampleRateActual
                                       ? store.runtime.sampleRateActual
                                       : (store && store.engine.audioClock ? store.engine.audioClock.sampleRate : 0)
    readonly property var outputMeters: store && !isSource && store.outputMeters[target] ? store.outputMeters[target] : ({})
    readonly property var meters: isSource
        ? [{ label: "", peakDb: sourceMeter.peakDb, rmsDb: sourceMeter.rmsDb }]
        : [{ label: "L", peakDb: outputMeters.left ? outputMeters.left.peakDb : -120, rmsDb: outputMeters.left ? outputMeters.left.rmsDb : -120 },
           { label: "R", peakDb: outputMeters.right ? outputMeters.right.peakDb : -120, rmsDb: outputMeters.right ? outputMeters.right.rmsDb : -120 }]
    readonly property var unavailableModels: {
        var models = store && store.engine.models ? store.engine.models : {};
        var out = [];
        for (var name in models)
            if (models[name] !== true)
                out.push(name);
        return out;
    }

    function pageOf(stage) { return isSource && (stage === "hp" || stage === "lp") ? "filters" : stage; }
    function docsOf(stage) {
        for (var i = 0; i < chain.length; ++i)
            if (chain[i].stage === stage)
                return chain[i].docs || [];
        return [];
    }
    function stageDescriptor(name) {
        var scopeKey = isSource ? "source" : "output";
        return parameters[scopeKey] && parameters[scopeKey][name] ? parameters[scopeKey][name] : ({ fields: [] });
    }
    function refresh() { if (client && target !== "") client.get(graphPath); }
    function pagePreviewOverrides() {
        return pageLoader.item ? (pageLoader.item["chainPreviewOverrides"] || ({})) : ({});
    }
    function pick(stage) { page = pageOf(stage); }
    function ensurePage() {
        for (var i = 0; i < chain.length; ++i)
            if (pageOf(chain[i].stage) === page)
                return;
        page = chain.length > 0 ? pageOf(chain[0].stage) : "";
    }

    // Les réglages changent souvent pendant un glissement : la chaîne est relue au plus toutes les 150 ms.
    Timer { id: debounce; interval: 150; onTriggered: ws.refresh() }
    onGraphPathChanged: { chain = []; refresh(); }
    onProcessingChanged: debounce.restart()
    Component.onCompleted: refresh()
    Connections {
        target: ws.client
        ignoreUnknownSignals: true
        function onResponseReceived(method, path, body) {
            if (method === "GET" && path === ws.graphPath) {
                ws.chain = body;
                ws.ensurePage();
            }
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            Text {
                Layout.fillWidth: true
                text: ws.isSource
                      ? (ws.source ? ws.source.name + " — " + ws.source.id + " · " + (ws.source.width === 1 ? "canal " + ws.source.firstChannel
                         : "canaux " + ws.source.firstChannel + "–" + (ws.source.firstChannel + ws.source.width - 1)) : "")
                      : (ws.target === "master" ? "Master — sorties 1/2" : "Cue — sorties 3/4")
                color: Theme.text
                font.pixelSize: 15
                font.bold: true
            }
            ConfirmButton {
                objectName: "button-reset-target"
                visible: ws.target !== ""
                text: ws.isSource ? "Réinitialiser la source" : (ws.target === "master" ? "Réinitialiser Master" : "Réinitialiser Cue")
                confirmText: ws.isSource ? "Confirmer : toute la chaîne, volume compris" : "Confirmer : tous les étages, volume compris"
                onConfirmed: ws.client.post(ws.base + "reset")
            }
            ActionButton {
                objectName: "button-copy-master"
                visible: !ws.isSource && ws.target === "cue"
                label: "Copier Master → Cue"
                onClicked: ws.client.post("/api/outputs/cue/copy-master")
            }
            ActionButton {
                objectName: "button-chain-response"
                label: ws.showChainResponse ? "Masquer la réponse cumulée" : "Réponse cumulée"
                onClicked: ws.showChainResponse = !ws.showChainResponse
            }
        }

        ChainStrip {
            objectName: "chain"
            Layout.fillWidth: true
            chain: ws.chain
            currentPage: ws.page
            pageOf: ws.pageOf
            onPicked: function (stage) { ws.pick(stage) }
        }

        ChainResponseGraph {
            objectName: "panel-chain-response"
            Layout.fillWidth: true
            Layout.preferredHeight: ws.showChainResponse ? 260 : 0
            visible: ws.showChainResponse
            processing: ws.processing
            curves: ws.curves
            sampleRate: ws.sampleRate
            isSource: ws.isSource
            previewOverrides: ws.pagePreviewOverrides()
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 10
            // La page occupe toute la hauteur ; si son contenu dépasse (« Avancé » déplié, petit écran),
            // elle défile verticalement.
            Flickable {
                id: pageView
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true
                contentWidth: width
                contentHeight: Math.max(height, pageLoader.item ? pageLoader.item.implicitHeight : 0)
                boundsBehavior: Flickable.StopAtBounds
                interactive: contentHeight > height
                ScrollBar.vertical: ScrollBar { policy: pageView.interactive ? ScrollBar.AlwaysOn : ScrollBar.AlwaysOff }
            Loader {
                id: pageLoader
                objectName: "page-loader"
                width: pageView.width - (pageView.interactive ? 12 : 0)
                height: pageView.contentHeight
                sourceComponent: {
                    switch (ws.page) {
                    case "filters": return filtersPage;
                    case "eq": return eqPage;
                    case "inputCompressor": case "compressor": return compressorPage;
                    case "bandCompressor": return multibandPage;
                    case "infraHpf": case "sideHpf": return highPassPage;
                    case "clipper": case "limiter": return limiterPage;
                    case "input": case "pitch": case "mix": return compactPage;
                    default: return null;
                    }
                }
            }
            }
            Rectangle {
                objectName: "gutter"
                Layout.fillHeight: true
                Layout.preferredWidth: 20 + ws.meters.length * 22
                color: Theme.panel; radius: 6; border.color: Theme.line
                Row {
                    anchors.fill: parent
                    anchors.margins: 8
                    spacing: 6
                    Repeater {
                        model: ws.meters
                        delegate: Column {
                            required property var modelData
                            height: parent.height
                            spacing: 2
                            Meter {
                                objectName: "meter-" + (modelData.label === "L" ? "left" : modelData.label === "R" ? "right" : "source")
                                height: parent.height - 16
                                implicitWidth: 16
                                peakDb: modelData.peakDb
                                rmsDb: modelData.rmsDb
                            }
                            Text { text: modelData.label; color: Theme.dim; font.pixelSize: Theme.fontSmall; anchors.horizontalCenter: parent.horizontalCenter }
                        }
                    }
                }
            }
        }
    }

    Component {
        id: filtersPage
        FiltersPage {
            client: ws.client; curves: ws.curves; parameters: ws.parameters; base: ws.base
            processing: ws.processing; context: ws.context; sampleRate: ws.sampleRate; docsOf: ws.docsOf
        }
    }
    Component {
        id: eqPage
        EqPage {
            client: ws.client; curves: ws.curves; descriptors: ws.stageDescriptor("eq"); path: ws.base + "eq"
            value: ws.processing.eq || ({}); sampleRate: ws.sampleRate; docs: ws.docsOf("eq")
        }
    }
    Component {
        id: compressorPage
        CompressorView {
            client: ws.client; curves: ws.curves; path: ws.base + ws.page
            title: ws.stageDescriptor(ws.page).label || ""
            value: ws.processing[ws.page] || ({}); descriptors: ws.stageDescriptor(ws.page); docs: ws.docsOf(ws.page)
            unavailableOptions: ws.isSource ? [] : ws.unavailableModels
        }
    }
    Component {
        id: multibandPage
        MultibandPage {
            client: ws.client; curves: ws.curves; parameters: ws.parameters; base: ws.base
            processing: ws.processing; sampleRate: ws.sampleRate; docs: ws.docsOf("bandCompressor")
        }
    }
    Component {
        id: highPassPage
        HighPassPage {
            client: ws.client; curves: ws.curves; descriptors: ws.stageDescriptor(ws.page); path: ws.base + ws.page
            value: ws.processing[ws.page] || ({}); sampleRate: ws.sampleRate; docs: ws.docsOf(ws.page)
            stageName: ws.page
            note: ws.page === "sideHpf" ? "sur le signal latéral (S)" : ""
        }
    }
    Component {
        id: limiterPage
        LimiterPage {
            client: ws.client; curves: ws.curves; descriptors: ws.stageDescriptor(ws.page); path: ws.base + ws.page
            value: ws.processing[ws.page] || ({}); docs: ws.docsOf(ws.page); kind: ws.page
        }
    }
    Component {
        id: compactPage
        CompactPage {
            client: ws.client; descriptors: ws.stageDescriptor(ws.page); path: ws.base + ws.page
            value: ws.processing[ws.page] || ({}); context: ws.context; docs: ws.docsOf(ws.page)
            indicator: ws.isSource && ws.page === "mix" ? "stereo" : (ws.page === "pitch" ? "pitch" : "none")
        }
    }
}
