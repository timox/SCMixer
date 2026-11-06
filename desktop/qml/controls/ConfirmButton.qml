import QtQuick
import "Theme.js" as Theme

// Action à confirmer : un premier clic arme le bouton (texte de confirmation), un second déclenche
// `confirmed`. Sans second clic dans les 4 s, le bouton se désarme.
Toggle {
    id: button
    property string text: ""
    property string confirmText: "Confirmer"
    property bool armed: false
    signal confirmed()

    label: armed ? confirmText : text
    checked: armed
    onColor: Theme.warn
    onToggled: {
        if (armed) {
            armed = false;
            confirmed();
        } else {
            armed = true;
            disarm.restart();
        }
    }
    Timer { id: disarm; interval: 4000; onTriggered: button.armed = false }
}
