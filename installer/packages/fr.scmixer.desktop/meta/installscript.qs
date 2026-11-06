// Raccourcis « SCMixer » (menu Démarrer et bureau) vers le lanceur SCMixer.cmd, qui démarre le service
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
    var launcher = "@TargetDir@/SCMixer.cmd";
    var options = "workingDirectory=@TargetDir@ iconPath=@TargetDir@/desktop/scmixer.exe iconId=0 description=Démarre le moteur SCMixer et son interface";
    component.addOperation("CreateShortcut", launcher, "@StartMenuDir@/SCMixer.lnk", options);
    component.addOperation("CreateShortcut", launcher, "@DesktopDir@/SCMixer.lnk", options);
    component.addOperation("Execute", "cmd", "/c", "exit", "0",
                           "UNDOEXECUTE", "cmd", "/c", "@TargetDir@/engine/engine.cmd", "stop");
};
