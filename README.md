# COWORK Desktop — Widget + Screensaver

Electron app เดียว รันได้ 2 โหมด ใช้โค้ดชุดเดียวกัน

```
cowork-desktop/
├─ main.js            Electron main (เลือกโหมดจาก --widget / --screensaver)
├─ preload.js         bridge ปิดหน้าต่าง / pin / ออก screensaver
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
Widget ดึงงานจริงจาก Redmine ต้องมีไฟล์ `.env` ในโฟลเดอร์นี้ (ไฟล์นี้ถูก gitignore ไว้ ไม่ขึ้น repo)

1. คัดลอกไฟล์ตัวอย่าง: `cp .env.example .env`  (Windows: `copy .env.example .env`)
2. เปิด `.env` แล้วใส่ค่า:
   ```
   REDMINE_URL=https://redmine.example.com
   REDMINE_API_KEY=<API key ของคุณ>
   ```
   หา API key ได้ที่ Redmine → คลิกชื่อมุมขวาบน → **My account** → ขวามือ **API access key** → **Show**

> ถ้าไม่ตั้งค่า `.env` widget จะยังเปิดได้แต่ส่วนงาน Redmine จะขึ้นข้อความว่าโหลดไม่สำเร็จ

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
- ดึง open issue ของ **ทุกโปรเจกต์** จาก Redmine API (key อยู่ใน `.env` ฝั่ง main process — renderer ไม่เห็น key)
- แยกตามสถานะเป็น tab: Backlog → New → In Progress → Test → Resolved (มีจุดสีบอกสถานะ)
- **ฟิลเตอร์โปรเจกต์ + ผู้รับผิดชอบ** เลือกได้หลายอันพร้อมกัน (ทำงานร่วมกันแบบ AND)
- แต่ละงานแสดง `#id · ชื่องาน · โปรเจกต์ · ผู้รับผิดชอบ · Risk Level` — คลิกที่งานเพื่อเปิดใน Redmine
- Risk Level ดึงจาก custom field แบ่งสีตามระดับ (Low → Fairly Low → Moderate → Medium → High)
- refresh อัตโนมัติทุก 5 นาที · ดูอย่างเดียว (คลิกไม่แก้ไขข้อมูลใน Redmine)

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

## หมายเหตุ
- ส่วนงาน Redmine ของ widget = ข้อมูลจริงจาก API แล้ว (ตั้งค่าใน `.env`)
- ส่วน "ภาพรวม vault" (proj / node / edge / todo) ยัง hardcode ใน html — ไว้ ver.2 ค่อยต่อจาก vault จริง
