# COWORK Desktop

Electron app เดียว รันได้ 2 โหมดด้วยโค้ดชุดเดียวกัน

- **Widget** — หน้าต่างลอยโปร่งใส ไม่มีขอบ รวม 3 แท็บ: งาน Redmine · Workspace vault · บันทึกประชุม
- **Screensaver** — เต็มจอ นาฬิกาใหญ่ + ข้อมูลหมุนวน ออกเมื่อขยับเมาส์

Windows only (แพ็กเป็น NSIS installer) · MIT

---

## เริ่มใช้งาน

ต้องมี [Node.js](https://nodejs.org) ก่อน

```bash
npm install
npm start
```

- `npm start` / `npm run widget` → เปิด widget (หรือดับเบิลคลิก `start-widget.bat`)
- `npm run screensaver` → เปิด screensaver (หรือ `start-screensaver.bat`)

ให้ widget เปิดพร้อม Windows: `Win+R` → `shell:startup` → วาง shortcut ของ `start-widget.bat` ลงไป
(ตัวที่ติดตั้งจาก installer ตั้ง auto-start ให้เองอยู่แล้ว)

---

## ตั้งค่า

กดปุ่มเฟือง ⚙ ที่แถบหัว widget — มี 3 การ์ด กรอกเฉพาะที่ใช้ก็ได้ แท็บที่ยังไม่ตั้งค่าจะขึ้นแบนเนอร์พร้อมปุ่มพาไปตั้งค่า ไม่พังทั้งแอป

| การ์ด | กรอกอะไร | หาได้จากไหน |
|---|---|---|
| **Redmine** | URL + API key | Redmine → คลิกชื่อมุมขวาบน → My account → ขวามือ **API access key** → Show |
| **Workspace** | path ของ A_Workspace vault | โฟลเดอร์ Obsidian vault ที่มี `Public/` `Private/` |
| **Meeting** | path ของโฟลเดอร์บันทึกประชุม | โฟลเดอร์ที่มีโฟลเดอร์ย่อยชื่อ `YYYY-MM-DD_HH-MM-ชื่อประชุม` |

ค่าทั้งหมดเก็บแยกต่อเครื่อง/ต่อคนที่ `%APPDATA%\COWORK Desktop\config.json` — **ไม่ได้ฝังอยู่ในตัวติดตั้ง** และ API key อยู่ฝั่ง main process เท่านั้น renderer มองไม่เห็น

**สำหรับ dev:** ตอนรันแบบไม่ได้แพ็ก (`npm start`) ถ้ายังไม่เคยตั้งค่าผ่านหน้าตั้งค่า จะ fallback ไปอ่าน `.env` ในโฟลเดอร์นี้ (gitignore ไว้แล้ว) — ตัวที่แพ็กเป็น .exe ไม่อ่าน `.env`

```
REDMINE_URL=<URL redmine ของคุณ>
REDMINE_API_KEY=<API key ของคุณ>
WORKSPACE_DIR=<path ของ A_Workspace vault>
MEETINGS_DIR=<path ของโฟลเดอร์ meetings>
```

---

## Widget

หน้าต่างลอย **โปร่งใส ไม่มีขอบ** ลากย้ายได้ที่แถบบน (◈ COWORK) ปรับขนาดได้ที่ขอบ เริ่มต้นวางมุมขวาบน — เป็นหน้าต่างจริงไม่ใช่ wallpaper เลยไม่โดนไอคอน desktop บัง

ปุ่มบนแถบหัว: 📌 ปักหมุดบนสุด · ⛶ ขยายเต็มจอ/คืนขนาด · ✕ ปิด · ⚙ ตั้งค่า

### แท็บ Redmine
- ดึง open + closed issue ของ **ทุกโปรเจกต์** จาก Redmine API (ไม่จำกัดจำนวน ตัวเลขทุก tab/stat เป็นค่าจริง)
- แยกตามสถานะเป็น tab: ALL → Backlog → New → In Progress → Test → Resolved → Closed (มีจุดสีบอกสถานะ · tab ALL = งานที่เปิดอยู่จริง ไม่รวม Closed/Backlog)
- **ฟิลเตอร์โปรเจกต์ + ผู้รับผิดชอบ** เลือกหลายอันพร้อมกันได้ (ทำงานร่วมกันแบบ AND) ตัวเลขบน chip แยกเป็น เปิด/ปิด
- แต่ละงานแสดง `#id · ชื่องาน · โปรเจกต์ · ผู้รับผิดชอบ · Risk Level` — คลิกเปิดใน Redmine · โชว์ทีละ 15 มีปุ่มโหลดเพิ่ม
- ปิดงานจากในแอปได้ (พรีวิว journal + ช่อง Test Results ก่อนยืนยัน)
- "ภาพรวม Redmine" = open / high risk / overdue / closed (การ์ด CLOSED กดขยายดูแยกรายปีได้)

### แท็บ Workspace
อ่าน A_Workspace markdown vault (โปรเจกต์ / บันทึกรายวัน / บทเรียน / playbook)
- การ์ดโปรเจกต์พร้อมสถานะ 🟢 กำลังทำ · 🟡 พัก · ✅ จบแล้ว แยก Public/Private
- ค้นหาโปรเจกต์ (ชื่อ / path / คำอธิบาย) + ฟิลเตอร์การมองเห็นและสถานะ
- ฟีดบันทึกรายวันล่าสุด และการ์ดบทเรียน/แผนรับมือ — คลิกเปิดไฟล์ .md ด้วยโปรแกรมของเครื่อง

### แท็บ Meeting
อ่านโฟลเดอร์บันทึกประชุม **1 โฟลเดอร์ = 1 ประชุม** ตั้งชื่อว่า `YYYY-MM-DD_HH-MM-ชื่อประชุม` ข้างในมี `summary.md` / `transcript.md` และไฟล์เสียง (ถ้ามี)

```
meetings/
├─ 2026-07-24_19-01-Meet1900/
│  ├─ summary.md          # สรุปโดย AI (markdown)
│  ├─ transcript.md       # **ผู้พูด 1** [00:18]: ข้อความ...
│  └─ Meet1900-19-01-45.ogg
└─ 2026-07-24_14-35-MEET_7/
   ├─ summary.md
   └─ transcript.md
```

- **รายการ** จัดกลุ่มตามวัน แต่ละแถวโชว์เวลา ชื่อ ตัวอย่างสรุป 2 บรรทัด แท็กหัวข้อ และป้ายจำนวนผู้พูด / ประโยค / action / ขนาดไฟล์เสียง — ประชุมที่ AI สรุปไม่ได้จะจางลงพร้อมป้าย ⚠
- **กรอง** ด้วยช่องค้นหา (ชื่อ + เนื้อหาสรุป) · ชิปวันที่ · **ชิปหมวดหัวข้อ** ที่ดึงจากหัวข้อย่อยในไฟล์สรุปมาให้อัตโนมัติ
- **หน้าอ่าน** แท็บ สรุป / ถอดเสียง / ไฟล์
  - สรุป — เรนเดอร์ markdown พร้อม **สารบัญคลิกกระโดด**
  - ถอดเสียง — **สีพื้นหลังแยกตามผู้พูด** กรองเฉพาะคนที่เลือกได้ ค้นหาในบทพร้อมไฮไลต์
  - ไฟล์ — คลิกเปิดด้วยโปรแกรมของเครื่อง (เช่น `.ogg` เปิดเครื่องเล่นเสียง)
- transcript โหลดเฉพาะตอนกดเข้าไปอ่าน (รายการส่งมาแค่ metadata + สรุป) ไฟล์เยอะก็ไม่อืด

ทุกแท็บ refresh อัตโนมัติทุก 5 นาที · Workspace/Meeting มีปุ่ม ↻ กดโหลดเองได้

---

## Screensaver

เต็มจอ นาฬิกาใหญ่ + ข้อมูลหมุนวน + graph node ลอยพื้นหลัง มี drift เบา ๆ กัน burn-in
**ออก:** ขยับเมาส์ / กดปุ่ม / คลิก / Esc

ให้เด้งเองตอนเครื่องว่างแบบ screensaver จริง (Electron ไม่ใช่ `.scr` ของ Windows แต่ทำให้เหมือนกันได้ด้วย Task Scheduler):

1. เปิด **Task Scheduler** → Create Task
2. Triggers → New → **On idle** (ตั้งเวลา idle เช่น 5 นาที)
3. Conditions → เปิด "Start the task only if the computer is idle for..."
4. Actions → Start a program → เลือก `start-screensaver.bat`

> อยากได้ `.scr` แท้ ๆ ที่ตั้งในหน้า Screen Saver Settings ของ Windows: เอา `screensaver.html` ไปใส่ **Wallpaper Engine** (Steam) ซึ่งมีโหมด screensaver ในตัว ใช้ HTML เดิมได้เลย

---

## โครงสร้างโค้ด

```
COWORK-Desktop/
├─ main.js            Electron main — เลือกโหมดจาก --widget / --screensaver,
│                     เรียก Redmine API, อ่าน vault, จัดการ config + auto-update
├─ preload.js         contextBridge — ทางเดียวที่ renderer คุยกับ main ได้
├─ workspace.js       parser ของ A_Workspace vault (.md) — รันเดี่ยวได้: node workspace.js <dir>
├─ meetings.js        parser ของโฟลเดอร์ประชุม      — รันเดี่ยวได้: node meetings.js <dir>
├─ widget.html        UI ของ widget ทั้งหมด (HTML + CSS + JS ในไฟล์เดียว)
├─ screensaver.html   UI ของ screensaver
├─ icons/             ไอคอนแอป (.ico สำหรับ Windows)
└─ start-*.bat        ทางลัดสำหรับดับเบิลคลิก
```

**หลักการ:** ไม่มี build step และไม่มี dependency ตอน runtime — มีแต่ Electron ตอน dev/แพ็ก · secret ทุกอย่างอยู่ฝั่ง main · parser แต่ละตัวเป็น pure fs/path เลยรันทดสอบนอก Electron ได้

`parser` สองตัวรับ markdown ที่เขียนมาแบบ CRLF — normalize `\r\n` → `\n` ตอนอ่านเสมอ ไม่งั้น regex ที่ปิดท้ายด้วย `$` จะไม่แมตช์อะไรเลยแบบเงียบ ๆ

---

## แพ็กและปล่อยเวอร์ชันใหม่

```bash
npm run dist          # ได้ installer ใน dist/
```

Widget ที่ติดตั้งแล้วเช็คเวอร์ชันใหม่จาก GitHub Releases ([`wowBALL/COWORK-Desktop`](https://github.com/wowBALL/COWORK-Desktop), public repo) เองตอนเปิดโปรแกรมและซ้ำทุก 1 ชั่วโมง เจอของใหม่จะโหลดเงียบ ๆ แล้วถามว่าจะรีสตาร์ทติดตั้งเลยไหม — ไม่ต้องใช้ token เพราะ repo เป็น public

กลไกนี้เขียนเอง ไม่ใช้ `electron-updater` เพราะ electron-updater มีบั๊กที่ไม่รักษา path ที่ผู้ใช้เลือกเองตอนติดตั้ง

**ขั้นตอนปล่อยเวอร์ชัน:**

1. bump `version` ใน `package.json` + เขียน `CHANGELOG.md`
2. `npm run dist`
3. `gh release create vX.X.X "dist/COWORK Desktop Setup X.X.X.exe" --repo wowBALL/COWORK-Desktop`
4. ลบ `dist/` ทิ้ง (ไฟล์ .exe ก้อนใหญ่ ไม่ต้องเก็บไว้ในเครื่อง)

เครื่องที่ติดตั้งไว้แล้วจะเห็นอัปเดตในรอบเช็คถัดไป ไม่ต้องแจกไฟล์เอง

---

## License

[MIT](LICENSE) © 2026 wowBALL
