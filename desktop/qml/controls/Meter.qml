import QtQuick
import "Theme.js" as Theme

// Vumètre : RMS en barre, crête en trait ; échelle -60..0 dBFS (valeurs publiées par l'API en dBFS).
Rectangle {
    id: meter
    property real peakDb: -120
    property real rmsDb: -120
    readonly property real floorDb: -60
    function level(db) { return Math.max(0, Math.min(1, (db - floorDb) / -floorDb)); }

    implicitWidth: 8
    implicitHeight: 120
    radius: 2
    color: Theme.meterBg

    Rectangle {
        anchors.bottom: parent.bottom
        width: parent.width
        radius: 2
        height: parent.height * meter.level(meter.rmsDb)
        gradient: Gradient {
            GradientStop { position: 0.0; color: meter.rmsDb > -3 ? Theme.mute : Theme.warn }
            GradientStop { position: 0.35; color: Theme.ok }
            GradientStop { position: 1.0; color: "#2f7a4c" }
        }
    }
    Rectangle {
        width: parent.width
        height: 2
        y: parent.height * (1 - meter.level(meter.peakDb)) - 1
        visible: meter.peakDb > meter.floorDb
        color: meter.peakDb > -1 ? Theme.mute : Theme.text
    }
}
