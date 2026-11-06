import QtQuick
import QtQuick.Layouts
import "../../controls"
import "../../graphs"
import "../../controls/Theme.js" as Theme

// EQ 3 bandes (source ou sortie) : réponse totale (trait épais) et réponse de chaque bande (couleur de
// bande), repère par bande avec fréquence et gain en dB ; une colonne de réglages par bande sous le
// graphe, puis les réglages communs. Les colonnes envoient toutes l'étage complet sur le même chemin.
Item {
    id: page
    property var client: null
    property var curves: null
    property var descriptors: ({ fields: [] })
    property string path: ""
    property var value: ({})
    property real sampleRate: 0
    property var docs: []

    readonly property var columns: [
        { band: "low", color: Theme.bandLow, keys: ["low", "lowFreq", "lowRs", "lowMul", "lowAdd"] },
        { band: "mid", color: Theme.bandMid, keys: ["mid", "midFreq", "midRq", "midMul", "midAdd"] },
        { band: "high", color: Theme.bandHigh, keys: ["high", "highFreq", "highRs", "highMul", "highAdd"] }
    ]
    // Aperçu : réglages confirmés avec la position en cours de la colonne qui glisse.
    readonly property var dragging: {
        for (var i = 0; i < bandRepeater.count; ++i) {
            var c = bandRepeater.itemAt(i);
            if (c && c.dragging)
                return c;
        }
        return common.dragging ? common : null;
    }
    function response(v) { return curves && sampleRate > 0 ? curves.eqResponse(v, sampleRate, 160) : []; }
    function fieldLabel(key) {
        var list = descriptors && descriptors.fields ? descriptors.fields : [];
        for (var i = 0; i < list.length; ++i)
            if (list[i].key === key)
                return list[i].label;
        return key;
    }
    function bandLabel(v, band) {
        return fieldLabel(band) + " " + Theme.formatValue(v[band + "Freq"], "Hz", 0) + ", "
               + (curves.eqBandDb(v, band) >= 0 ? "+" : "") + curves.eqBandDb(v, band).toFixed(1) + " dB";
    }
    readonly property real span: Math.max(12, Math.ceil((Number(value.rangeDb) + 3) / 6) * 6)

    implicitHeight: eqLayout.implicitHeight

    ColumnLayout {
        id: eqLayout
        anchors.fill: parent
        spacing: 10
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumHeight: 220
            color: Theme.panel; radius: 6; border.color: Theme.line
            FrequencyGraph {
                objectName: "graph-eq"
                anchors.fill: parent
                anchors.margins: 8
                topDb: page.span
                bottomDb: -page.span
                gridDb: page.span > 12 ? 6 : 3
                emptyText: page.sampleRate > 0 ? "" : "Fréquence d'échantillonnage inconnue (moteur arrêté)"
                series: {
                    var confirmed = page.response(page.value);
                    var list = [
                        { points: confirmed, key: "low", color: Theme.bandLow, width: 1 },
                        { points: confirmed, key: "mid", color: Theme.bandMid, width: 1 },
                        { points: confirmed, key: "high", color: Theme.bandHigh, width: 1 },
                        { points: confirmed, key: "db", color: Theme.accent, width: 2.5 }
                    ];
                    if (page.dragging)
                        list.push({ points: page.response(page.dragging.preview), key: "db", color: Theme.preview, width: 1.5, dashed: true });
                    return list;
                }
                markers: {
                    if (!page.curves || page.value.lowFreq === undefined)
                        return [];
                    var v = page.dragging ? page.dragging.preview : page.value;
                    return page.columns.map(function (c) {
                        return { hz: v[c.band + "Freq"], label: page.bandLabel(v, c.band), color: c.color };
                    });
                }
            }
        }
        RowLayout {
            Layout.fillWidth: true
            spacing: 10
            Repeater {
                id: bandRepeater
                model: page.columns
                delegate: StageControls {
                    required property var modelData
                    objectName: "eq-" + modelData.band
                    Layout.fillWidth: true
                    Layout.preferredWidth: 1
                    Layout.alignment: Qt.AlignTop
                    client: page.client
                    title: page.fieldLabel(modelData.band)
                    titleColor: modelData.color
                    path: page.path
                    value: page.value
                    descriptors: page.descriptors
                    keys: modelData.keys
                }
            }
            StageControls {
                id: common
                objectName: "eq-common"
                Layout.preferredWidth: 220
                Layout.alignment: Qt.AlignTop
                client: page.client
                title: "Commun"
                path: page.path
                value: page.value
                descriptors: page.descriptors
                keys: ["rangeDb", "controlLag"]
                docs: page.docs
            }
        }
    }
}
