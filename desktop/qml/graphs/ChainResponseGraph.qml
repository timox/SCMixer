import QtQuick
import QtQuick.Layouts
import "ChainResponse.js" as ChainResponse
import "../controls/Theme.js" as Theme

Item {
    id: view
    property var processing: ({})
    property var curves: null
    property real sampleRate: 0
    property bool isSource: true
    property var previewOverrides: ({})

    readonly property var confirmed: ChainResponse.frequencyResponse(processing, isSource, curves, sampleRate, 160, ({}))
    readonly property var preview: ChainResponse.frequencyResponse(processing, isSource, curves, sampleRate, 160, previewOverrides)
    readonly property bool hasPreview: Object.keys(previewOverrides).length > 0

    implicitHeight: 260

    ColumnLayout {
        anchors.fill: parent
        spacing: 4
        RowLayout {
            Layout.fillWidth: true
            Text { text: "Réponse cumulée"; color: Theme.text; font.pixelSize: Theme.fontNormal; font.bold: true }
            Text { Layout.fillWidth: true; elide: Text.ElideRight; text: "EQ, filtres et répartiteur · réponse calculée"; color: Theme.dim; font.pixelSize: Theme.fontSmall }
            Rectangle { Layout.preferredWidth: 18; Layout.preferredHeight: 1; color: Theme.dim }
            Text { text: "0 dB"; color: Theme.dim; font.pixelSize: Theme.fontSmall }
            Rectangle { Layout.preferredWidth: 18; Layout.preferredHeight: 2; color: Theme.accent }
            Text { text: view.isSource ? "Chaîne" : "Centre (M)"; color: Theme.dim; font.pixelSize: Theme.fontSmall }
            Rectangle { visible: !view.isSource; Layout.preferredWidth: 18; Layout.preferredHeight: 2; color: Theme.bandHigh }
            Text { visible: !view.isSource; text: "Côtés (S)"; color: Theme.dim; font.pixelSize: Theme.fontSmall }
            Rectangle { visible: view.hasPreview; Layout.preferredWidth: 18; Layout.preferredHeight: 2; color: Theme.preview }
            Text { visible: view.hasPreview; text: "Aperçu"; color: Theme.dim; font.pixelSize: Theme.fontSmall }
        }
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: Theme.panel; radius: 6; border.color: Theme.line
            FrequencyGraph {
                objectName: "graph-chain-response"
                anchors.fill: parent
                anchors.margins: 6
                topDb: 6
                bottomDb: -60
                emptyText: view.sampleRate > 0 ? "" : "Démarrer le moteur pour calculer la réponse"
                series: {
                    if (view.confirmed.mid.length === 0)
                        return [];
                    var lines = [
                        { points: view.confirmed.mid.map(function (point) { return { hz: point.hz, db: 0 }; }), key: "db", color: Theme.dim, width: 1, dashed: true },
                        { points: view.confirmed.mid, key: "db", color: Theme.accent, width: 2.5 }
                    ];
                    if (!view.isSource)
                        lines.push({ points: view.confirmed.side, key: "db", color: Theme.bandHigh, width: 2 });
                    if (view.hasPreview && view.preview.mid.length > 0) {
                        lines.push({ points: view.preview.mid, key: "db", color: Theme.preview, width: 1.5, dashed: true });
                        if (!view.isSource)
                            lines.push({ points: view.preview.side, key: "db", color: Theme.preview, width: 1, dashed: true });
                    }
                    return lines;
                }
            }
        }
    }
}
