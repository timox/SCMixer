import QtQuick
import QtQuick.Layouts
import "../../controls"
import "../../graphs"
import "../../controls/Theme.js" as Theme

// Passe-haut et passe-bas d'une source : réponse combinée (trait épais) et réponses de chaque filtre
// (traits fins), fréquences de coupure en Hz ; réglages HP sous la moitié gauche, LP sous la droite.
Item {
    id: page
    property var client: null
    property var curves: null
    property var parameters: ({})
    property string base: ""
    property var processing: ({})
    property var context: ({})
    property real sampleRate: 0
    property var docsOf: function (stage) { return []; }

    readonly property var hp: processing.hp || ({})
    readonly property var lp: processing.lp || ({})
    readonly property bool dragging: hpControls.dragging || lpControls.dragging
    readonly property var chainPreviewOverrides: dragging ? ({ hp: hpControls.dragging ? hpControls.preview : hp,
                                                               lp: lpControls.dragging ? lpControls.preview : lp }) : ({})
    function response(h, l) { return curves && sampleRate > 0 ? curves.filterResponse(h, l, sampleRate, 160) : []; }
    function cutoffLabel(name, stage) { return name + " " + Theme.formatValue(curves ? curves.cutoffHz(stage) : 0, "Hz", 0); }

    implicitHeight: filtersLayout.implicitHeight

    ColumnLayout {
        id: filtersLayout
        anchors.fill: parent
        spacing: 10
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumHeight: 220
            color: Theme.panel; radius: 6; border.color: Theme.line
            FrequencyGraph {
                id: graph
                objectName: "graph-filters"
                anchors.fill: parent
                anchors.margins: 8
                topDb: 12
                bottomDb: -48
                active: (page.hp.inserted !== false && page.hp.enabled === true)
                        || (page.lp.inserted !== false && page.lp.enabled === true)
                emptyText: page.sampleRate > 0 ? "" : "Fréquence d'échantillonnage inconnue (moteur arrêté)"
                series: {
                    var confirmed = page.response(page.hp, page.lp);
                    var list = [
                        { points: confirmed, key: "hpDb", color: Theme.bandLow, width: 1 },
                        { points: confirmed, key: "lpDb", color: Theme.bandHigh, width: 1 },
                        { points: confirmed, key: "db", color: Theme.accent, width: 2.5 }
                    ];
                    if (page.dragging)
                        list.push({ points: page.response(hpControls.preview, lpControls.preview), key: "db", color: Theme.preview, width: 1.5, dashed: true });
                    return list;
                }
                markers: {
                    var list = [];
                    if (page.hp.inserted !== false && page.hp.enabled)
                        list.push({ hz: page.curves.cutoffHz(page.hp), label: page.cutoffLabel("HP", page.hp), color: Theme.bandLow });
                    if (page.lp.inserted !== false && page.lp.enabled)
                        list.push({ hz: page.curves.cutoffHz(page.lp), label: page.cutoffLabel("LP", page.lp), color: Theme.bandHigh });
                    if (hpControls.dragging)
                        list.push({ hz: page.curves.cutoffHz(hpControls.preview), label: "aperçu " + page.cutoffLabel("HP", hpControls.preview), color: Theme.preview });
                    if (lpControls.dragging)
                        list.push({ hz: page.curves.cutoffHz(lpControls.preview), label: "aperçu " + page.cutoffLabel("LP", lpControls.preview), color: Theme.preview });
                    return list;
                }
            }
        }
        RowLayout {
            Layout.fillWidth: true
            spacing: 10
            StageControls {
                id: hpControls
                objectName: "panel-hp"
                Layout.fillWidth: true
                Layout.preferredWidth: 1
                Layout.alignment: Qt.AlignTop
                client: page.client
                title: page.parameters.source ? page.parameters.source.hp.label : ""
                titleColor: Theme.bandLow
                path: page.base + "hp"
                value: page.hp
                descriptors: page.parameters.source ? page.parameters.source.hp : ({ fields: [] })
                context: page.context
                docs: page.docsOf("hp")
            }
            StageControls {
                id: lpControls
                objectName: "panel-lp"
                Layout.fillWidth: true
                Layout.preferredWidth: 1
                Layout.alignment: Qt.AlignTop
                client: page.client
                title: page.parameters.source ? page.parameters.source.lp.label : ""
                titleColor: Theme.bandHigh
                path: page.base + "lp"
                value: page.lp
                descriptors: page.parameters.source ? page.parameters.source.lp : ({ fields: [] })
                context: page.context
                docs: page.docsOf("lp")
                ActionButton {
                    label: "Réinitialiser l'état du filtre"
                    visible: page.lp.model === "MoogFF"
                    onClicked: page.client.post(page.base + "lp/reset-state")
                }
            }
        }
    }
}
