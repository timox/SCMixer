// Maquette statique de l'interface native du moteur SC.
// Données fictives, aucun appel à l'API. Lancement :
//   C:\Qt\6.12.0\mingw_64\bin\qml.exe Maquette.qml
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

ApplicationWindow {
    id: win
    width: 1440; height: 860
    visible: true
    title: "Mixette — moteur SC (maquette)"
    color: pal.bg

    QtObject {
        id: pal
        readonly property color bg: "#16181c"
        readonly property color panel: "#1f2228"
        readonly property color panel2: "#272b33"
        readonly property color line: "#343944"
        readonly property color text: "#d9dde4"
        readonly property color dim: "#8a919e"
        readonly property color accent: "#5aa9e6"
        readonly property color ok: "#6cc08b"
        readonly property color warn: "#e0b354"
        readonly property color mute: "#d9645a"
    }

    property var sources: [
        { id: "src-1", name: "Micro voix", first: 1, width: 1, vol: 0.78, bal: 0.5, cue: 0.0, mute: false, gain: 0.9, eq: [0.55, 0.5, 0.62], pitch: 0, lvl: 0.62 },
        { id: "src-2", name: "Platine A", first: 2, width: 2, vol: 0.85, bal: 0.5, cue: 0.4, mute: false, gain: 1.0, eq: [0.5, 0.5, 0.5], pitch: 0, lvl: 0.81 },
        { id: "src-3", name: "Platine B", first: 4, width: 2, vol: 0.0, bal: 0.5, cue: 1.0, mute: false, gain: 1.0, eq: [0.35, 0.5, 0.6], pitch: -2, lvl: 0.45 },
        { id: "src-4", name: "Synthé multicanal", first: 6, width: 5, vol: 0.66, bal: 0.42, cue: 0.0, mute: false, gain: 0.8, eq: [0.6, 0.45, 0.5], pitch: 0, lvl: 0.55 },
        { id: "src-5", name: "Retour externe", first: 11, width: 2, vol: 0.5, bal: 0.5, cue: 0.0, mute: true, gain: 1.0, eq: [0.5, 0.5, 0.5], pitch: 0, lvl: 0.0 }
    ]
    property int selected: 1
    // Onglet de départ : dernier argument numérique de la ligne de commande (0 = Sources).
    Component.onCompleted: {
        var a = Qt.application.arguments, t = 0;
        for (var i = 0; i < a.length; i++) if (/^[0-4]$/.test(a[i])) t = parseInt(a[i]);
        tabs.currentIndex = t;
    }

    // ---------- Composants ----------
    component Knob: Item {
        property real value: 0.5
        property string label: ""
        property string valueText: ""
        width: 48; height: 66
        Canvas {
            id: c; width: 44; height: 44; anchors.horizontalCenter: parent.horizontalCenter
            onPaint: {
                var ctx = getContext("2d"); ctx.reset();
                var a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, r = 17;
                ctx.lineWidth = 4; ctx.lineCap = "round";
                ctx.strokeStyle = pal.line; ctx.beginPath(); ctx.arc(22, 22, r, a0, a1); ctx.stroke();
                ctx.strokeStyle = pal.accent; ctx.beginPath(); ctx.arc(22, 22, r, a0, a0 + (a1 - a0) * value); ctx.stroke();
                var a = a0 + (a1 - a0) * value;
                ctx.strokeStyle = pal.text; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(22 + Math.cos(a) * 7, 22 + Math.sin(a) * 7); ctx.lineTo(22 + Math.cos(a) * 15, 22 + Math.sin(a) * 15); ctx.stroke();
            }
        }
        Text { anchors.top: c.bottom; anchors.horizontalCenter: parent.horizontalCenter; text: label; color: pal.dim; font.pixelSize: 10 }
        Text { anchors.top: c.top; anchors.topMargin: 15; anchors.horizontalCenter: parent.horizontalCenter; text: valueText; color: pal.text; font.pixelSize: 9 }
    }

    component Meter: Rectangle {
        property real level: 0.5
        width: 8; color: "#0f1114"; radius: 2
        Rectangle {
            anchors.bottom: parent.bottom; width: parent.width; radius: 2
            height: parent.height * level
            gradient: Gradient {
                GradientStop { position: 0.0; color: level > 0.9 ? pal.mute : pal.warn }
                GradientStop { position: 0.35; color: pal.ok }
                GradientStop { position: 1.0; color: "#2f7a4c" }
            }
        }
    }

    component Fader: Item {
        property real value: 0.7
        width: 30
        Rectangle { anchors.horizontalCenter: parent.horizontalCenter; width: 4; height: parent.height; color: pal.line; radius: 2 }
        Rectangle {
            anchors.horizontalCenter: parent.horizontalCenter
            y: (1 - value) * (parent.height - height)
            width: 28; height: 14; radius: 3; color: pal.panel2; border.color: pal.accent
            Rectangle { anchors.centerIn: parent; width: 18; height: 2; color: pal.text }
        }
    }

    component SmallButton: Rectangle {
        property string label: ""
        property bool on: false
        property color onColor: pal.accent
        width: 34; height: 20; radius: 3
        color: on ? onColor : pal.panel2; border.color: pal.line
        Text { anchors.centerIn: parent; text: label; color: on ? "#101215" : pal.text; font.pixelSize: 10; font.bold: true }
    }

    component Section: Rectangle {
        property string title: ""
        default property alias content: body.data
        color: pal.panel; radius: 6; border.color: pal.line
        Text { id: t; x: 12; y: 8; text: title; color: pal.dim; font.pixelSize: 11; font.capitalization: Font.AllUppercase; font.letterSpacing: 1 }
        Item { id: body; anchors.fill: parent; anchors.topMargin: 28; anchors.margins: 10 }
    }

    component ResponseCurve: Canvas {
        property real hp: 0.12
        property real lp: 0.82
        onPaint: {
            var ctx = getContext("2d"); ctx.reset();
            ctx.strokeStyle = pal.line; ctx.lineWidth = 1;
            for (var i = 0; i <= 4; i++) { var y = height * i / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
            [0.1, 0.33, 0.66, 0.9].forEach(function (x) { ctx.beginPath(); ctx.moveTo(width * x, 0); ctx.lineTo(width * x, height); ctx.stroke(); });
            ctx.strokeStyle = pal.accent; ctx.lineWidth = 2; ctx.beginPath();
            for (var px = 0; px <= width; px += 2) {
                var f = px / width;
                var db = -12 * Math.log(1 + Math.pow(Math.max(0, hp - f) * 12, 2)) - 12 * Math.log(1 + Math.pow(Math.max(0, f - lp) * 12, 2));
                var yy = height * 0.25 - db * height / 48;
                if (px === 0) ctx.moveTo(px, yy); else ctx.lineTo(px, yy);
            }
            ctx.stroke();
        }
    }

    component CompCurve: Canvas {
        onPaint: {
            var ctx = getContext("2d"); ctx.reset();
            ctx.strokeStyle = pal.line; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(0, height); ctx.lineTo(width, 0); ctx.stroke();
            ctx.strokeStyle = pal.warn; ctx.lineWidth = 2; ctx.beginPath();
            var th = 0.6;
            ctx.moveTo(0, height); ctx.lineTo(width * th, height * (1 - th));
            ctx.lineTo(width, height * (1 - th - (1 - th) * 0.25)); ctx.stroke();
        }
    }

    // ---------- Fenêtre ----------
    header: Rectangle {
        height: 46; color: pal.panel; border.color: pal.line
        RowLayout {
            anchors.fill: parent; anchors.leftMargin: 14; anchors.rightMargin: 14; spacing: 18
            Text { text: "Mixette · moteur SC"; color: pal.text; font.pixelSize: 16; font.bold: true }
            TabBar {
                id: tabs; Layout.preferredWidth: 560
                background: Rectangle { color: "transparent" }
                Repeater {
                    model: ["Sources", "Sorties", "Presets", "Moteur", "Routage"]
                    TabButton {
                        text: modelData
                        contentItem: Text { text: parent.text; color: parent.checked ? pal.text : pal.dim; font.pixelSize: 13; horizontalAlignment: Text.AlignHCenter }
                        background: Rectangle { color: parent.checked ? pal.panel2 : "transparent"; radius: 4
                            Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 2; color: parent.parent.checked ? pal.accent : "transparent" } }
                    }
                }
            }
            Item { Layout.fillWidth: true }
            Rectangle { width: 10; height: 10; radius: 5; color: pal.ok }
            Text { text: "Moteur : en marche · 48 kHz / 256 · CPU 18 %"; color: pal.dim; font.pixelSize: 12 }
            Rectangle { width: 10; height: 10; radius: 5; color: pal.ok }
            Text { text: "API connectée"; color: pal.dim; font.pixelSize: 12 }
        }
    }

    StackLayout {
        anchors.fill: parent; anchors.margins: 12
        currentIndex: tabs.currentIndex

        // ===== Sources =====
        RowLayout {
            spacing: 12
            // Tranches
            Rectangle {
                Layout.fillHeight: true; Layout.preferredWidth: 760
                color: pal.panel; radius: 6; border.color: pal.line
                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 10; spacing: 8
                    RowLayout {
                        Text { text: "Sources · 12 canaux utilisés sur 256"; color: pal.dim; font.pixelSize: 12 }
                        Item { Layout.fillWidth: true }
                        Rectangle { width: 130; height: 26; radius: 4; color: pal.accent
                            Text { anchors.centerIn: parent; text: "+ Ajouter une source"; color: "#101215"; font.pixelSize: 12; font.bold: true } }
                    }
                    ListView {
                        Layout.fillWidth: true; Layout.fillHeight: true
                        orientation: ListView.Horizontal; spacing: 8; clip: true
                        model: win.sources
                        delegate: Rectangle {
                            width: 138; height: ListView.view.height
                            radius: 5; color: index === win.selected ? pal.panel2 : "#1b1e23"
                            border.color: index === win.selected ? pal.accent : pal.line
                            MouseArea { anchors.fill: parent; onClicked: win.selected = index }
                            Column {
                                anchors.fill: parent; anchors.margins: 8; spacing: 6
                                Text { text: modelData.name; color: pal.text; font.pixelSize: 13; font.bold: true; elide: Text.ElideRight; width: parent.width }
                                Text { text: "Entrées " + modelData.first + (modelData.width > 1 ? "–" + (modelData.first + modelData.width - 1) : "") + " · " + modelData.width + " can."; color: pal.dim; font.pixelSize: 10 }
                                Row { spacing: 2
                                    Knob { value: modelData.gain; label: "Gain"; valueText: Math.round(modelData.gain * 100) }
                                    Knob { value: modelData.pitch / 24 + 0.5; label: "Pitch"; valueText: (modelData.pitch > 0 ? "+" : "") + modelData.pitch }
                                }
                                Row { spacing: -4
                                    Knob { value: modelData.eq[2]; label: "Aigu"; valueText: ((modelData.eq[2] * 2 - 1) * 12).toFixed(0) }
                                    Knob { value: modelData.eq[1]; label: "Méd."; valueText: ((modelData.eq[1] * 2 - 1) * 12).toFixed(0) }
                                    Knob { value: modelData.eq[0]; label: "Grave"; valueText: ((modelData.eq[0] * 2 - 1) * 12).toFixed(0) }
                                }
                                Row { spacing: 2
                                    Knob { value: modelData.bal; label: "Balance"; valueText: modelData.bal === 0.5 ? "C" : (modelData.bal < 0.5 ? "G" : "D") }
                                    Knob { value: modelData.cue; label: "Cue"; valueText: Math.round(modelData.cue * 100) }
                                }
                                Row { spacing: 6; anchors.horizontalCenter: parent.horizontalCenter
                                    SmallButton { label: "M"; on: modelData.mute; onColor: pal.mute }
                                    SmallButton { label: "CUE"; on: modelData.cue > 0; onColor: pal.warn; width: 40 }
                                }
                                Row {
                                    height: 170; spacing: 10; anchors.horizontalCenter: parent.horizontalCenter
                                    Fader { height: parent.height; value: modelData.vol }
                                    Meter { height: parent.height; level: modelData.mute ? 0 : modelData.lvl }
                                    Column { spacing: 0
                                        Repeater { model: ["0", "-6", "-12", "-24", "-36", "-60"]
                                            Text { text: modelData; color: pal.dim; font.pixelSize: 9; height: 170 / 6 } } }
                                }
                                Text { text: modelData.vol === 0 ? "-inf dB" : (20 * Math.log(modelData.vol) / Math.LN10).toFixed(1) + " dB"; color: pal.text; font.pixelSize: 11; anchors.horizontalCenter: parent.horizontalCenter }
                            }
                        }
                    }
                }
            }
            // Détails de la source sélectionnée
            ColumnLayout {
                Layout.fillWidth: true; Layout.fillHeight: true; spacing: 12
                RowLayout {
                    Text { text: "Détails · " + win.sources[win.selected].name + "  (" + win.sources[win.selected].id + ")"; color: pal.text; font.pixelSize: 15; font.bold: true }
                    Item { Layout.fillWidth: true }
                    Text { text: "Modifier canaux / largeur…"; color: pal.accent; font.pixelSize: 12 }
                }
                Section {
                    title: "Filtres HP / LP"
                    Layout.fillWidth: true; Layout.preferredHeight: 240
                    RowLayout {
                        anchors.fill: parent; spacing: 14
                        ColumnLayout { spacing: 6
                            Text { text: "HP · BHiPass ▾"; color: pal.text; font.pixelSize: 12 }
                            Row { spacing: 2
                                Knob { value: 0.12; label: "Fréq."; valueText: "47" }
                                Knob { value: 0.1; label: "Q"; valueText: "1.0" } }
                            Row { spacing: 6; SmallButton { label: "ON"; on: true } SmallButton { label: "RAZ"; width: 38 } }
                            Item { height: 8 }
                            Text { text: "LP · MoogFF ▾"; color: pal.text; font.pixelSize: 12 }
                            Row { spacing: 2
                                Knob { value: 0.82; label: "Fréq."; valueText: "6.3k" }
                                Knob { value: 0.5; label: "Gain"; valueText: "2.0" } }
                            Row { spacing: 6; SmallButton { label: "ON"; on: true } SmallButton { label: "RAZ"; width: 38 } SmallButton { label: "Reset état"; width: 74 } }
                        }
                        Rectangle { Layout.fillWidth: true; Layout.fillHeight: true; color: "#121418"; radius: 4
                            ResponseCurve { anchors.fill: parent; anchors.margins: 8 }
                            Text { x: 10; y: parent.height - 18; text: "20 Hz"; color: pal.dim; font.pixelSize: 9 }
                            Text { x: parent.width - 42; y: parent.height - 18; text: "20 kHz"; color: pal.dim; font.pixelSize: 9 } }
                    }
                }
                RowLayout {
                    Layout.fillWidth: true; Layout.fillHeight: true; spacing: 12
                    Section {
                        title: "Compresseur d'entrée"
                        Layout.preferredWidth: 300; Layout.fillHeight: true
                        ColumnLayout { anchors.fill: parent
                            Row { spacing: 0
                                Knob { value: 0.75; label: "Seuil"; valueText: "-20" }
                                Knob { value: 0.2; label: "Ratio"; valueText: "4:1" }
                                Knob { value: 0.1; label: "Att."; valueText: "10" }
                                Knob { value: 0.1; label: "Rel."; valueText: "100" }
                                Knob { value: 0.5; label: "Makeup"; valueText: "0" } }
                            Rectangle { Layout.fillWidth: true; Layout.fillHeight: true; color: "#121418"; radius: 4
                                CompCurve { anchors.fill: parent; anchors.margins: 8 } }
                            SmallButton { label: "Bypass"; on: true; width: 60 }
                        }
                    }
                    Section {
                        title: "Compresseur multibande · croisements 250 Hz / 4 kHz"
                        Layout.fillWidth: true; Layout.fillHeight: true
                        RowLayout { anchors.fill: parent; spacing: 10
                            Repeater { model: ["Grave", "Médium", "Aigu"]
                                Rectangle { Layout.fillWidth: true; Layout.fillHeight: true; color: pal.panel2; radius: 4
                                    Column { anchors.fill: parent; anchors.margins: 6; spacing: 2
                                        Text { text: modelData; color: pal.text; font.pixelSize: 12 }
                                        Row { Knob { value: 0.75; label: "Seuil"; valueText: "-20" } Knob { value: 0.2; label: "Ratio"; valueText: "4:1" } }
                                        Row { Knob { value: 0.1; label: "Att."; valueText: "10" } Knob { value: 0.1; label: "Rel."; valueText: "100" } }
                                        Row { spacing: 6; Knob { value: 0.5; label: "Makeup"; valueText: "0" } SmallButton { label: "Bypass"; on: index !== 0; width: 54; anchors.verticalCenter: parent.verticalCenter } }
                                    } } }
                        }
                    }
                }
            }
        }

        // ===== Sorties =====
        RowLayout {
            spacing: 12
            Repeater {
                model: [{ n: "Master", o: "sorties 1/2 → SSL 12 sorties 1/2" }, { n: "Cue", o: "sorties 3/4 → SSL 12 casque" }]
                Section {
                    title: modelData.n + " · " + modelData.o
                    Layout.fillWidth: true; Layout.fillHeight: true
                    RowLayout { anchors.fill: parent; spacing: 16
                        ColumnLayout { spacing: 12
                            Row { spacing: 2
                                Knob { value: 0.6; label: "Grave 200"; valueText: "+2" }
                                Knob { value: 0.5; label: "Méd. 1k"; valueText: "0" }
                                Knob { value: 0.55; label: "Aigu 8k"; valueText: "+1" } }
                            Row { spacing: 8
                                Column { SmallButton { label: "ON"; on: false } Knob { value: 0.05; label: "HPF infra"; valueText: "25" } }
                                Column { SmallButton { label: "ON"; on: true } Knob { value: 0.1; label: "HPF M/S"; valueText: "100" } } }
                            Row { spacing: 8
                                Column { SmallButton { label: "ON"; on: false } Knob { value: 1.0; label: "Clipper"; valueText: "0" } }
                                Column { SmallButton { label: "ON"; on: true } Knob { value: 0.96; label: "Limiteur"; valueText: "-1" } } }
                            Text { text: index === 1 ? "Copier Master → Cue" : ""; color: pal.accent; font.pixelSize: 12 }
                        }
                        ColumnLayout { Layout.fillWidth: true; Layout.fillHeight: true; spacing: 8
                            Text { text: "Compresseur · Compander ▾   (CompanderD · FaustRMS)"; color: pal.text; font.pixelSize: 12 }
                            Row { Knob { value: 0.75; label: "Seuil"; valueText: "-20" } Knob { value: 0.25; label: "Pente <"; valueText: "1.0" }
                                  Knob { value: 0.06; label: "Pente >"; valueText: "0.25" } Knob { value: 0.1; label: "Att."; valueText: "10" }
                                  Knob { value: 0.1; label: "Rel."; valueText: "100" } Knob { value: 0.25; label: "Mul"; valueText: "1.0" } }
                            Rectangle { Layout.fillWidth: true; Layout.fillHeight: true; color: "#121418"; radius: 4
                                CompCurve { anchors.fill: parent; anchors.margins: 8 } }
                        }
                        Row { Layout.fillHeight: true; spacing: 8
                            Fader { height: parent.height; value: 0.8 }
                            Meter { height: parent.height; level: 0.72 }
                            Meter { height: parent.height; level: 0.68 } }
                    }
                }
            }
        }

        // ===== Presets =====
        Section {
            title: "Presets · session complète (sources, traitements, Master, Cue)"
            ColumnLayout { anchors.fill: parent; spacing: 6
                RowLayout { Rectangle { width: 260; height: 28; color: pal.panel2; radius: 4; border.color: pal.line
                        Text { x: 8; anchors.verticalCenter: parent.verticalCenter; text: "Nom du preset…"; color: pal.dim } }
                    Rectangle { width: 110; height: 28; radius: 4; color: pal.accent
                        Text { anchors.centerIn: parent; text: "Enregistrer"; color: "#101215"; font.bold: true } } }
                Repeater { model: [["preset-3", "Soirée deux platines", "05/11 18:42"], ["preset-2", "Test multicanal", "04/11 21:10"], ["preset-1", "Réglage neutre", "02/11 10:05"]]
                    Rectangle { Layout.fillWidth: true; height: 40; color: pal.panel2; radius: 4
                        RowLayout { anchors.fill: parent; anchors.margins: 10
                            Text { text: modelData[1]; color: pal.text; font.pixelSize: 13; Layout.preferredWidth: 300 }
                            Text { text: modelData[0] + " · " + modelData[2]; color: pal.dim; font.pixelSize: 11 }
                            Item { Layout.fillWidth: true }
                            Text { text: "Appliquer (remplace la session)"; color: pal.accent; font.pixelSize: 12 }
                            Text { text: "   Supprimer"; color: pal.mute; font.pixelSize: 12 } } } }
                Item { Layout.fillHeight: true }
            }
        }

        // ===== Moteur =====
        RowLayout { spacing: 12
            Section { title: "Cycle de vie et profil audio"; Layout.preferredWidth: 420; Layout.fillHeight: true
                Column { spacing: 10
                    Text { text: "État : en marche · scsynth PID 31204"; color: pal.text; font.pixelSize: 13 }
                    Row { spacing: 8; SmallButton { label: "Démarrer"; width: 80 } SmallButton { label: "Arrêter"; width: 80 } SmallButton { label: "Redémarrer"; width: 90 } }
                    Text { text: "Pilote : ASIO TimoxVasio (fixe) · 256 entrées · 4 sorties"; color: pal.dim; font.pixelSize: 12 }
                    Text { text: "Fréquence : 48000 Hz ▾      Buffer : 256 trames ▾"; color: pal.text; font.pixelSize: 12 }
                    Text { text: "Un changement de profil redémarre scsynth et restaure la session."; color: pal.warn; font.pixelSize: 11 }
                    Item { height: 10; width: 1 }
                    Text { text: "Runtime"; color: pal.dim; font.pixelSize: 11 }
                    Text { text: "CPU moy. 18 % · crête 26 %\nSynthés 41 · UGens 1 240 · groupes 9\n48 000 Hz effectifs · bloc 64 · latence 5,3 ms\nDernier /fail : aucun"; color: pal.text; font.pixelSize: 12; lineHeight: 1.3 }
                } }
            Section { title: "Arbre des nœuds"; Layout.fillWidth: true; Layout.fillHeight: true
                Text { text: "Groupe racine\n  sources\n    src-1  in → eq → hp → lp → pitch → dyn → mix\n    src-2  in → eqdirect → hp → lp → pitch → dyn → mix\n    src-3  …\n  bancs\n  sorties\n    master_output (Compander) → writer 1/2\n    cue_output (Compander) → writer 3/4"; color: pal.text; font.family: "Consolas"; font.pixelSize: 12; lineHeight: 1.3 } }
            Section { title: "Bancs de test"; Layout.preferredWidth: 320; Layout.fillHeight: true
                Column { spacing: 10
                    Text { text: "Banc compresseur (3 s, signal interne)"; color: pal.text; font.pixelSize: 12 }
                    SmallButton { label: "Lancer"; width: 70 }
                    Text { text: "Banc EQ · bruit rose à la place de Master"; color: pal.text; font.pixelSize: 12 }
                    Text { text: "Méthode : threeBand ▾"; color: pal.dim; font.pixelSize: 12 }
                    Row { Knob { value: 0.5; label: "Grave"; valueText: "0" } Knob { value: 0.5; label: "Méd."; valueText: "0" } Knob { value: 0.5; label: "Aigu"; valueText: "0" } }
                    Row { spacing: 8; SmallButton { label: "Démarrer"; width: 80 } SmallButton { label: "Arrêter"; width: 70 } }
                } }
        }

        // ===== Routage =====
        Section {
            title: "Routage TimoxVasio · lecture seule"
            Column { spacing: 8
                Text { text: "Les routes se modifient dans l'interface TimoxVasio."; color: pal.warn; font.pixelSize: 12 }
                Repeater { model: [
                        ["Micro voix", "entrée 1", "SSL 12 · entrée 1"],
                        ["Platine A", "entrées 2–3", "mixxx.exe · sorties 1–2"],
                        ["Platine B", "entrées 4–5", "mixxx.exe · sorties 3–4"],
                        ["Synthé multicanal", "entrées 6–10", "renoise.exe · sorties 1–5"],
                        ["Retour externe", "entrées 11–12", "aucune route"],
                        ["Master", "sorties 1/2", "SSL 12 · sorties 1/2"],
                        ["Cue", "sorties 3/4", "SSL 12 · casque"] ]
                    Rectangle { width: 900; height: 32; color: pal.panel2; radius: 4
                        Row { anchors.verticalCenter: parent.verticalCenter; x: 10; spacing: 20
                            Text { width: 200; text: modelData[0]; color: pal.text; font.pixelSize: 13 }
                            Text { width: 140; text: modelData[1]; color: pal.dim; font.pixelSize: 12 }
                            Text { text: (index < 5 ? "← " : "→ ") + modelData[2]; color: modelData[2] === "aucune route" ? pal.mute : pal.text; font.pixelSize: 12 } } } }
            }
        }
    }
}
