// Raccourcis « Mixette SC » (menu Démarrer et bureau) vers le lanceur Mixette.cmd, qui démarre le service
// moteur avec le SuperCollider embarqué puis l'interface. À la désinstallation, le service lancé depuis ce
// dossier est d'abord arrêté (engine.cmd stop : seul un PID inscrit dans son registre est arrêté).

function Component()
{
}

Component.prototype.createOperations = function ()
{
    component.createOperations();
    if (systemInfo.productType !== "windows")
        return;
    var launcher = "@TargetDir@/Mixette.cmd";
    var options = "workingDirectory=@TargetDir@ iconPath=@TargetDir@/desktop/mixette-desktop.exe iconId=0 description=Démarre le moteur Mixette SC et son interface";
    component.addOperation("CreateShortcut", launcher, "@StartMenuDir@/Mixette SC.lnk", options);
    component.addOperation("CreateShortcut", launcher, "@DesktopDir@/Mixette SC.lnk", options);
    component.addOperation("Execute", "cmd", "/c", "exit", "0",
                           "UNDOEXECUTE", "cmd", "/c", "@TargetDir@/engine/engine.cmd", "stop");
};
