; Instalador del POS. T0.8 deja solo copiar archivos y crear el acceso directo.
; El servicio de Windows, el registro de impresión y el autoarranque se agregan en T7.2.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{B6F0A7D2-5C1E-4C57-9B0B-2F3E8D5A1C11}
AppName=Punto de Venta
AppVersion={#AppVersion}
AppPublisher=Ravyn Studio
DefaultDirName={autopf}\PuntoDeVenta
DefaultGroupName=Punto de Venta
OutputBaseFilename=PuntoDeVenta-Setup-{#AppVersion}
OutputDir=Output
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
Source: "..\staging\node\*"; DestDir: "{app}\node"; Flags: recursesubdirs ignoreversion
Source: "..\staging\app\*"; DestDir: "{app}\app"; Flags: recursesubdirs ignoreversion
Source: "..\staging\pos\*"; DestDir: "{app}\pos"; Flags: recursesubdirs ignoreversion

[Icons]
; Abre la interfaz en el navegador predeterminado del usuario.
Name: "{autodesktop}\Punto de Venta"; Filename: "http://localhost:3000"
