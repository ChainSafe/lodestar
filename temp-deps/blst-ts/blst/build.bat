@echo off
set TOP=%~dp0
cl /nologo /c /O2 /Zi /Fdblst.pdb /W4 /MT /Zl %TOP%src\server.c || EXIT /B
cl 2>&1 | find "for ARM64" > nul:
IF ERRORLEVEL 1 (
    FOR %%F IN (%TOP%build\win64\*-x86_64.asm) DO (
        ml64 /nologo /c /Cp /Cx /Zi %%F || EXIT /B
    )
) ELSE (
    FOR %%F IN (%TOP%build\win64\*-armv8.asm) DO (
        armasm64 -nologo %%F || EXIT /B
    )
)
SETLOCAL ENABLEDELAYEDEXPANSION
set static=/out:blst.lib
set shared=
FOR %%O IN (%*) DO (
    set opt=%%O
    IF "!opt!" == "-shared" (
        IF [!shared!] EQU [] set shared=/out:blst.dll
    ) ELSE IF "!opt:~0,5!" == "/out:" (
	IF "!opt:~-4!" == ".dll" (set shared=!opt!) ELSE (set static=!opt!)
    )
)
IF [%shared%] NEQ [] (
    cl /nologo /c /O2 /Oi- /MD %TOP%build\win64\dll.c || EXIT /B
    link /nologo /debug /dll /entry:DllMain /incremental:no %shared% /def:%TOP%build\win64\blst.def *.obj kernel32.lib && del *.obj
) ELSE (
    lib /nologo %static% *.obj && del *.obj
)
ENDLOCAL
EXIT /B
