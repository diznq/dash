@echo off
cd data
mkdir %1
cd %1
ffmpeg ^
  -y -i "..\..\%1.mp4" ^
  -f dash^
  -c:v libx264 -b:v 1.25M -maxrate 2M^
  -c:a aac -b:a 128k^
  -map 0^
  -use_timeline 1^
  -use_template 1^
  -adaptation_sets "id=0,streams=v id=1,streams=a"^
  "%1.mpd"
cd ..
cd ..