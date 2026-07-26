# COWORK Desktop — Widget + Screensaver

Electron app เดียว รันได้ 2 โหมด ใช้โค้ดชุดเดียวกัน

```
cowork-desktop/
├─ main.js            Electron main (เลือกโหมดจาก --widget / --screensaver)
├─ preload.js         bridge ปิดหน้าต่าง / pin / ออก screensaver
├─ workspace.js       อ่าน A_Workspace vault (.md) ให้ tab Workspace
├─ meetings.js        อ่านโฟลเดอร์บันทึกประชุม (summary/transcript) ให้ tab Meeting
├─ widget.html        หน้าต่างลอย โปร่งใส ลากได้
├─ screensaver.html   เต็มจอ ambient ออกเมื่อขยับเมาส์/กดปุ่ม
├─ icons/             ไอคอนแอป (.ico สำหรับ Windows)
├─ start-widget.bat
└─ start-screensaver.bat
```

## ติดตั้งครั้งแรก
ต้องมี Node.js ก่อน แล้ว:
```bash
cd cowork-desktop
npm install        # โหลด electron (~ครั้งเดียว)
```

### ตั้งค่า Redmine (จำเป็นสำหรับ widget)
ตั้งค่าได้ในตัวแอปเลย — กดปุ่มเฟือง ⚙ ที่แถบหัว widget แล้วกรอก Redmine URL + API key (หาได้ที่ Redmine → คลิกชื่อมุมขวาบน → **My account** → ขวามือ **API access key** → **Show**) มีปุ่มทดสอบการเชื่อมต่อก่อนบันทึกให้ด้วย

ค่าที่กรอกเก็บแยกต่อเครื่อง/ต่อคนที่ `%APPDATA%\COWORK Desktop\config.json` (ไม่ได้ฝังอยู่ในตัวติดตั้ง) — ถ้ายังไม่ตั้งค่า widget จะยังเปิดได้ปกติ แค่ส่วนงาน Redmine จะขึ้นแบนเนอร์ "ยังไม่ได้ตั้งค่า" พร้อมปุ่มพาไปตั้งค่า

**สำหรับ dev เท่านั้น:** รันแบบ `npm start` (ไม่ได้แพ็กเป็น .exe) จะ fallback ไปอ่านไฟล์ `.env` ในโฟลเดอร์นี้แทนถ้ายังไม่เคยตั้งค่าผ่านหน้าตั้งค่า — สร้างไฟล์ `.env` เอง (gitignore ไว้แล้ว ไม่ขึ้น repo):
```
REDMINE_URL=<URL redmine ของคุณ>
REDMINE_API_KEY=<API key ของคุณ>
WORKSPACE_DIR=<path ของ A_Workspace vault>
MEETINGS_DIR=<path ของโฟลเดอร์ meetings>
```

## รัน
- **Widget:**  ดับเบิลคลิก `start-widget.bat`  (หรือ `npm run widget`)
- **Screensaver:**  ดับเบิลคลิก `start-screensaver.bat`  (หรือ `npm run screensaver`)

---

## Widget
- หน้าต่างลอย **โปร่งใส ไม่มีขอบ** — ลากย้ายได้ที่แถบบน (◈ COWORK)
- ปุ่ม 📌 = ปักหมุดให้อยู่บนสุดตลอด (always-on-top)
- ปุ่ม ⛶ = ขยายเต็มจอ / กดอีกครั้งคืนขนาดเดิม
- ปุ่ม ✕ = ปิด
- ปรับขนาดได้ที่ขอบหน้าต่าง · เริ่มต้นวางมุมขวาบน
- **ไม่โดนไอคอน desktop บัง** เพราะเป็นหน้าต่างจริง ไม่ใช่ wallpaper

### งาน Redmine (ดึงข้อมูลจริง)
- ดึง open + closed issue ของ **ทุกโปรเจกต์** จาก Redmine API (URL/key ตั้งค่าผ่านหน้าตั้งค่าในแอป ฝั่ง main process — renderer ไม่เห็น key)
- แยกตามสถานะเป็น tab: Backlog → New → In Progress → Test → Resolved (มีจุดสีบอกสถานะ)
- **ฟิลเตอร์โปรเจกต์ + ผู้รับผิดชอบ** เลือกได้หลายอันพร้อมกัน (ทำงานร่วมกันแบบ AND)
- แต่ละงานแสดง `#id · ชื่องาน · โปรเจกต์ · ผู้รับผิดชอบ · Risk Level` — คลิกที่งานเพื่อเปิดใน Redmine
- Risk Level ดึงจาก custom field แบ่งสีตามระดับ (Low → Fairly Low → Moderate → Medium → High)
- refresh อัตโนมัติทุก 5 นาที · ดูอย่างเดียว (คลิกไม่แก้ไขข้อมูลใน Redmine)

### Meeting (บันทึกประชุม)
อ่านโฟลเดอร์บันทึกประชุมที่ตั้งค่าไว้ (⚙ → การ์ด **Meeting**) — 1 โฟลเดอร์ = 1 ประชุม ตั้งชื่อว่า `YYYY-MM-DD_HH-MM-ชื่อประชุม` ข้างในมี `summary.md` / `transcript.md` และไฟล์เสียง (ถ้ามี)
- **รายการ:** จัดกลุ่มตามวัน แต่ละแถวโชว์เวลา ชื่อ ตัวอย่างสรุป 2 บรรทัด แท็กหัวข้อ และป้ายจำนวนผู้พูด/ประโยค/action/ขนาดไฟล์เสียง
- **กรอง:** ค้นหา (ชื่อ + เนื้อหาสรุป) · ชิปวันที่ · **ชิปหมวดหัวข้อ** ที่ดึงจากหัวข้อย่อยในไฟล์สรุปอัตโนมัติ
- **หน้าอ่าน:** แท็บ สรุป / ถอดเสียง / ไฟล์ — หน้าสรุปมี**สารบัญคลิกกระโดด**, หน้าถอดเสียงแยก**สีพื้นหลังต่อผู้พูด** กรองเฉพาะคนที่เลือกได้ และค้นหาในบทถอดเสียงพร้อมไฮไลต์
- แท็บไฟล์คลิกเปิดด้วยโปรแกรมของเครื่อง (เช่น `.ogg` เปิดเครื่องเล่นเสียง) · refresh อัตโนมัติทุก 5 นาที มีปุ่ม ↻ กดเองได้
- transcript โหลดเฉพาะตอนกดเข้าไปอ่าน (รายการส่งมาแค่ metadata + สรุป) จะได้ไม่อืดเวลาไฟล์เยอะ

เปิดพร้อม Windows: กด `Win+R` → `shell:startup` → วาง shortcut ของ `start-widget.bat` ลงไป

## Screensaver
- เต็มจอ นาฬิกาใหญ่ + ข้อมูลหมุนวน + graph node ลอยพื้นหลัง
- มี drift เบาๆ กัน burn-in
- **ออก:** ขยับเมาส์ / กดปุ่ม / คลิก / Esc

### ให้เด้งเองตอนเครื่องว่าง (idle) แบบ screensaver จริง
Electron ไม่ใช่ `.scr` ของ Windows โดยตรง แต่ทำให้ทำงานเหมือนกันได้ด้วย Task Scheduler:
1. เปิด **Task Scheduler** → Create Task
2. Triggers → New → **On idle** (ตั้งเวลา idle เช่น 5 นาที)
3. Conditions → เปิด "Start the task only if the computer is idle for..." ตั้งเวลา
4. Actions → Start a program → เลือก `start-screensaver.bat`
เมื่อขยับเมาส์ แอปจะปิดตัวเอง

> อยากได้ `.scr` แท้ๆ ที่ตั้งในหน้า Screen Saver Settings ของ Windows: เอา `screensaver.html` ไปใส่ **Wallpaper Engine** (Steam) ซึ่งมีโหมด screensaver ในตัว — ใช้ HTML เดิมได้เลย ไม่ต้องแก้

---

## แพ็กเป็น .exe (ถ้าอยากได้ไฟล์เดียว)
```bash
npm install --save-dev electron-builder
npx electron-builder --win
```
ได้ installer ใน `dist/` แจกลงเครื่องอื่นได้

## อัปเดตอัตโนมัติ
Widget ที่ติดตั้งแล้วเช็คเวอร์ชันใหม่จาก GitHub Releases (`wowBALL/COWORK-Desktop`, public repo) เองตอนเปิดโปรแกรม และเช็คซ้ำทุก 1 ชั่วโมง — ถ้ามีเวอร์ชันใหม่จะโหลดมาเงียบๆ แล้วถามว่าจะรีสตาร์ทติดตั้งเลยไหม

กลไกนี้เขียนเอง (ไม่ใช้ `electron-updater`) เพราะ electron-updater มีบั๊กที่ไม่รักษา path ที่เลือกเองตอนติดตั้ง — รายละเอียดใน `docs/superpowers/specs/2026-07-22-custom-auto-update-design.md` ไม่ต้องใช้ token ใดๆ เพราะ repo เป็น public

ตอนจะออกเวอร์ชันใหม่:
1. bump `version` ใน `package.json` แล้ว `npm run dist`
2. อัปโหลด `.exe` จาก `dist/` ขึ้นเป็น GitHub Release (เช่น `gh release create vX.X.X "dist/COWORK Desktop Setup X.X.X.exe" --repo wowBALL/COWORK-Desktop`) — widget ของทุกคนที่ติดตั้งไว้แล้วจะเห็นอัปเดตในเช็ครอบถัดไปโดยไม่ต้องแจกไฟล์เอง

## หมายเหตุ
- ส่วนงาน Redmine ของ widget = ข้อมูลจริงจาก API แล้ว (ตั้งค่าผ่านปุ่มเฟือง ⚙ ในแอป)
- "ภาพรวม Redmine" (open / high risk / overdue / closed) = ข้อมูลจริงจาก API แล้วเช่นกัน
- Workspace tab ต้องตั้งค่า path ของ vault เอง (โชว์ให้กรอกในแท็บนั้นถ้ายังไม่ได้ตั้งค่า) ไม่ได้ฝัง path ไว้อีกต่อไป
- Meeting tab เหมือนกัน — ตั้ง path โฟลเดอร์ประชุมเองผ่าน ⚙ (เก็บใน `config.json` เดียวกัน)
