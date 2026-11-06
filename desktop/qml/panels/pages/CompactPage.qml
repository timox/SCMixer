import QtQuick
import QtQuick.Layouts
import "../../controls"
import "../../graphs"
import "../../controls/Theme.js" as Theme
import "../../controls/Contract.js" as Contract

// Étage sans courbe de fréquence : réglages à gauche, indicateur graphique à droite.
// indicator "none" : réglages seuls (les vumètres sont dans la gouttière de l'espace de travail) ;
// "stereo" : position stéréo (balance, écartement pour 3 canaux et plus, niveau) ;
// "pitch" : position sur la plage de transposition, rapport de hauteur, mélange direct / décalé.
// Les positions sont calculées sur les bornes publiées par le catalogue.
Item {
    id: page
    property var client: null
    property var descriptors: ({ fields: [] })
    property string path: ""
    property var value: ({})
    property var context: ({})
    property var docs: []
    property string indicator: "none"

    function field(key) {
        var list = descriptors && descriptors.fields ? descriptors.fields : [];
        for (var i = 0; i < list.length; ++i)
            if (list[i].key === key)
                return list[i];
        return null;
    }
    // Position 0..1 d'une valeur sur la plage du champ.
    function norm(key, v) {
        var f = field(key);
        if (!f || f.max === f.min || v === undefined)
            return -1;
        return (Number(v) - f.min) / (f.max - f.min);
    }
    readonly property var shown: controls.dragging ? controls.preview : value

    implicitHeight: compactLayout.implicitHeight

    RowLayout {
        id: compactLayout
        anchors.fill: parent
        spacing: 12
        StageControls {
            id: controls
            objectName: "stage-controls"
            Layout.fillWidth: true
            Layout.alignment: Qt.AlignTop
            client: page.client
            title: page.descriptors.label || ""
            path: page.path
            value: page.value
            descriptors: page.descriptors
            context: page.context
            docs: page.docs
        }
        Rectangle {
            visible: page.indicator !== "none"
            Layout.preferredWidth: 420
            Layout.preferredHeight: 200
            Layout.alignment: Qt.AlignTop
            color: Theme.panel; radius: 6; border.color: Theme.line

            StereoPosition {
                objectName: "indicator-stereo"
                visible: page.indicator === "stereo"
                anchors.fill: parent
                anchors.margins: 16
                position: Math.max(0, page.norm("balance", page.value.balance))
                previewPosition: controls.dragging ? page.norm("balance", controls.preview.balance) : -1
                spread: page.context.width >= 3 ? page.norm("spread", page.shown.spread) : -1
                level: page.shown.mute ? 0 : Math.max(0, page.norm("volume", page.shown.volume))
                active: !page.value.mute
            }

            Column {
                objectName: "indicator-pitch"
                visible: page.indicator === "pitch"
                anchors.fill: parent
                anchors.margins: 16
                spacing: 10
                Text {
                    text: "Rapport de hauteur ×" + Math.pow(2, Number(page.shown.semitones) / 12).toFixed(3)
                    color: Theme.text
                    font.pixelSize: Theme.fontTitle
                }
                Item {
                    width: parent.width
                    height: 28
                    Rectangle { y: 10; width: parent.width; height: 8; radius: 3; color: Theme.meterBg }
                    Rectangle { x: parent.width / 2 - 1; width: 2; height: parent.height; color: Theme.line }
                    Rectangle {
                        x: Math.max(0, page.norm("semitones", page.shown.semitones)) * parent.width - 4
                        width: 8; height: parent.height; radius: 2
                        color: controls.dragging ? Theme.preview : Theme.accent
                    }
                }
                Text { text: "Mélange : direct ← → transposé"; color: Theme.dim; font.pixelSize: Theme.fontSmall }
                Rectangle {
                    width: parent.width
                    height: 10
                    radius: 3
                    color: Theme.meterBg
                    Rectangle {
                        width: parent.width * Math.max(0, page.norm("blend", page.shown.blend))
                        height: parent.height; radius: 3
                        color: Theme.bandMid
                    }
                }
            }
        }
    }
}
