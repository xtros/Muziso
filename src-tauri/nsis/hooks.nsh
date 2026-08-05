!macro customInstall
  DetailPrint "Relocating GStreamer DLLs to application root..."
  CopyFiles /SILENT "$INSTDIR\resources\gstreamer\bin\*.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\resources\libs\*.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\gstreamer\bin\*.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\libs\*.dll" "$INSTDIR"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CopyFiles /SILENT "$INSTDIR\resources\gstreamer\bin\*.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\resources\libs\*.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\gstreamer\bin\*.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\libs\*.dll" "$INSTDIR"
!macroend


