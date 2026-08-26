@echo off
chcp 949 >nul
setlocal

REM ================== 설정 (경로가 다르면 이 3줄만 고치세요) ==================
set PROJECT=D:\kokringadmin-main\kokringadmin-main\detail-page-automation
set IMAGES=D:\kokringadmin-main\kokring_shangpei\Grip+doll
set OUTPUT=D:\kokringadmin-main\kokring_shangpei
set PRODUCT=graydoll
REM ===========================================================================

echo.
echo  [ 콕링 상세페이지 생성기 ]
echo.

cd /d "%PROJECT%" 2>nul
if errorlevel 1 (
  echo  [오류] 프로젝트 폴더를 찾을 수 없습니다.
  echo         %PROJECT%
  echo         이 파일 위쪽의 PROJECT 경로를 실제 위치로 고쳐주세요.
  goto :end
)

where node >nul 2>nul
if errorlevel 1 (
  echo  [오류] Node.js 가 설치되어 있지 않습니다.
  echo         https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해주세요.
  goto :end
)

if not exist "%IMAGES%" (
  echo  [오류] 사진 폴더를 찾을 수 없습니다.
  echo         %IMAGES%
  echo         이 파일 위쪽의 IMAGES 경로를 실제 사진 폴더로 고쳐주세요.
  goto :end
)

if not exist "node_modules\playwright" (
  echo  최초 1회 준비 중입니다. 몇 분 걸립니다...
  echo.
  call npm install
  if errorlevel 1 goto :fail
  call npx playwright install chromium
  if errorlevel 1 goto :fail
  echo.
)

echo  상세페이지를 만드는 중입니다...
echo.
call node generate.js %PRODUCT% --images "%IMAGES%" --out "%OUTPUT%"
if errorlevel 1 goto :fail

echo.
echo  ============================================================
echo   완료되었습니다.
echo   저장 위치: %OUTPUT%\%PRODUCT%\
echo   파일: %PRODUCT%_1.png ~ %PRODUCT%_5.png
echo  ============================================================
start "" "%OUTPUT%\%PRODUCT%"
goto :end

:fail
echo.
echo  [실패] 위에 표시된 오류 내용을 확인해주세요.

:end
echo.
pause
