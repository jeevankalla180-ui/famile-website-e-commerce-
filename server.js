const express = require("express");
const cors = require("cors");
const db = require("./src/database");

const app = express();
const PORT = 3000;
const FAMILY_CODE = "@sry@2026&";
const FAMILY_SURNAME = "kalla";

app.use(cors());
app.use(express.json());

const clean = v => String(v || "").trim();
const upper = v => clean(v).toUpperCase();

function generateFamilyCode(callback) {
  db.get("SELECT code FROM families ORDER BY id DESC LIMIT 1", [], (err, row) => {
    if (err) return callback(err);
    let next = 1;
    if (row && row.code) {
      const n = parseInt(String(row.code).replace("F", ""), 10);
      if (!isNaN(n)) next = n + 1;
    }
    callback(null, "F" + String(next).padStart(3, "0"));
  });
}

app.get("/", (req, res) => {
  res.json({
    message: "Family backend running",
    login: "name + surname + family code",
    surname: "kalla",
    automaticFamilySeries: "F001, F002, F003",
    tables: ["login_records", "families", "persons"]
  });
});

app.post("/api/login", (req, res) => {
  const name = clean(req.body.name);
  const surname = clean(req.body.surname).toLowerCase();
  const code = clean(req.body.code);

  if (!name || !surname || !code) {
    return res.status(400).json({ error: "Name, surname and verification code required" });
  }
  if (surname !== FAMILY_SURNAME) {
    return res.status(401).json({ error: "Only Kalla family members allowed" });
  }
  if (code !== FAMILY_CODE) {
    return res.status(401).json({ error: "Wrong family verification code" });
  }

  db.run("INSERT INTO login_records(name, surname) VALUES(?, ?)", [name, surname], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Login successful", loginId: this.lastID, name, surname });
  });
});

app.get("/api/login-records", (req, res) => {
  db.all("SELECT id,name,surname,login_time FROM login_records ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get("/api/families", (req, res) => {
  db.all("SELECT * FROM families ORDER BY id ASC", [], (err, families) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all("SELECT * FROM persons ORDER BY id ASC", [], (err2, persons) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const data = families.map(f => {
        const ps = persons.filter(p => p.family_id === f.id);
        const husband = ps.find(p => p.role === "husband");
        const wife = ps.find(p => p.role === "wife");
        const children = ps.filter(p => p.role === "child");

        return {
          id: f.id,
          code: f.code,
          parentFamilyCode: f.parent_family_code,
          parentChildName: f.parent_child_name,
          husband: husband ? {
            id: husband.id, name: husband.name, gender: husband.gender,
            birthDate: husband.birth_date || "", deceased: Boolean(husband.deceased),
            movementNote: husband.movement_note || ""
          } : null,
          wife: wife ? {
            id: wife.id, name: wife.name, gender: wife.gender,
            birthDate: wife.birth_date || "", deceased: Boolean(wife.deceased),
            movementNote: wife.movement_note || ""
          } : null,
          children: children.map(c => ({
            id: c.id, name: c.name, gender: c.gender, birthDate: c.birth_date || "",
            deceased: Boolean(c.deceased), marriedFamilyCode: c.married_family_code,
            movementNote: c.movement_note || ""
          }))
        };
      });

      res.json(data);
    });
  });
});

app.post("/api/families", (req, res) => {
  const husbandName = clean(req.body.husbandName);
  const wifeName = clean(req.body.wifeName);

  if (!husbandName || !wifeName) {
    return res.status(400).json({ error: "Husband name and wife name required" });
  }

  generateFamilyCode((err, code) => {
    if (err) return res.status(500).json({ error: err.message });

    db.run("INSERT INTO families(code) VALUES(?)", [code], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      const familyId = this.lastID;

      db.run("INSERT INTO persons(family_id,name,gender,role) VALUES(?,?,?,?)", [familyId, husbandName, "male", "husband"]);
      db.run("INSERT INTO persons(family_id,name,gender,role) VALUES(?,?,?,?)", [familyId, wifeName, "female", "wife"], err3 => {
        if (err3) return res.status(500).json({ error: err3.message });
        res.json({ message: `Root family created successfully. Family Series: ${code}`, familyId, code });
      });
    });
  });
});

app.post("/api/children", (req, res) => {
  const familyCode = upper(req.body.familyCode);
  const fatherName = clean(req.body.fatherName);
  const childName = clean(req.body.childName);
  const gender = clean(req.body.gender);
  const birthDate = clean(req.body.birthDate);

  if (!familyCode || !fatherName || !childName || !gender) {
    return res.status(400).json({ error: "Family code, father name, child name and gender required" });
  }

  db.get("SELECT * FROM families WHERE code=?", [familyCode], (err, family) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!family) return res.status(404).json({ error: "Family not found" });

    db.get("SELECT * FROM persons WHERE family_id=? AND role='husband'", [family.id], (err2, father) => {
      if (err2) return res.status(500).json({ error: err2.message });
      if (!father || father.name.toLowerCase() !== fatherName.toLowerCase()) {
        return res.status(400).json({ error: `Father must be ${father ? father.name : "unknown"}` });
      }

      db.run("INSERT INTO persons(family_id,name,gender,role,birth_date) VALUES(?,?,?,?,?)",
        [family.id, childName, gender, "child", birthDate], function(err3) {
          if (err3) return res.status(500).json({ error: err3.message });
          res.json({ message: "Child added successfully", childId: this.lastID });
        });
    });
  });
});

app.post("/api/marriage", (req, res) => {
  const originFamilyCode = upper(req.body.originFamilyCode);
  const husbandName = clean(req.body.husbandName);
  const wifeName = clean(req.body.wifeName);
  const wifeMovementNote = clean(req.body.wifeMovementNote);

  if (!originFamilyCode || !husbandName || !wifeName) {
    return res.status(400).json({ error: "Origin family code, son name and wife name required" });
  }

  db.get("SELECT * FROM families WHERE code=?", [originFamilyCode], (err, origin) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!origin) return res.status(404).json({ error: "Origin family not found" });

    db.get("SELECT * FROM persons WHERE family_id=? AND role='child' AND lower(name)=lower(?)",
      [origin.id, husbandName], (err2, child) => {
        if (err2) return res.status(500).json({ error: err2.message });
        if (!child) return res.status(404).json({ error: "Son not found in origin family" });
        if (child.gender !== "male") return res.status(400).json({ error: "Only son marriage can create new family" });
        if (child.married_family_code) return res.status(400).json({ error: "This son already has a marriage family branch" });

        generateFamilyCode((codeErr, newCode) => {
          if (codeErr) return res.status(500).json({ error: codeErr.message });

          db.run("INSERT INTO families(code,parent_family_code,parent_child_name) VALUES(?,?,?)",
            [newCode, originFamilyCode, child.name], function(err3) {
              if (err3) return res.status(500).json({ error: err3.message });
              const newFamilyId = this.lastID;

              db.run("INSERT INTO persons(family_id,name,gender,role,birth_date) VALUES(?,?,?,?,?)",
                [newFamilyId, child.name, "male", "husband", child.birth_date || ""]);
              db.run("INSERT INTO persons(family_id,name,gender,role,movement_note) VALUES(?,?,?,?,?)",
                [newFamilyId, wifeName, "female", "wife", wifeMovementNote]);
              db.run("UPDATE persons SET married_family_code=? WHERE id=?", [newCode, child.id], err4 => {
                if (err4) return res.status(500).json({ error: err4.message });
                res.json({ message: `Marriage family created successfully. Family Series: ${newCode}`, newFamilyId, code: newCode });
              });
            });
        });
      });
  });
});

app.put("/api/person/deceased", (req, res) => {
  const familyCode = upper(req.body.familyCode);
  const name = clean(req.body.name);

  if (!familyCode || !name) {
    return res.status(400).json({ error: "Family code and person name required" });
  }

  db.run("UPDATE persons SET deceased=1 WHERE lower(name)=lower(?) AND family_id=(SELECT id FROM families WHERE code=?)",
    [name, familyCode], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Person not found" });
      res.json({ message: "Person marked deceased" });
    });
});

app.delete("/api/person", (req, res) => {
  const familyCode = upper(req.body.familyCode);
  const name = clean(req.body.name);

  if (!familyCode || !name) {
    return res.status(400).json({ error: "Family code and person name required" });
  }

  db.get("SELECT * FROM families WHERE code=?", [familyCode], (err, family) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!family) return res.status(404).json({ error: "Family not found" });

    db.get("SELECT * FROM persons WHERE family_id=? AND lower(name)=lower(?)", [family.id, name], (err2, person) => {
      if (err2) return res.status(500).json({ error: err2.message });
      if (!person) return res.status(404).json({ error: "Person not found" });

      if (person.role === "husband" || person.role === "wife") {
        db.get("SELECT COUNT(*) AS total FROM persons WHERE family_id=? AND role='child'", [family.id], (err3, row) => {
          if (err3) return res.status(500).json({ error: err3.message });
          if (row.total > 0) return res.status(400).json({ error: "Cannot delete parent when children exist" });

          db.run("DELETE FROM families WHERE id=?", [family.id], err4 => {
            if (err4) return res.status(500).json({ error: err4.message });
            res.json({ message: "Family deleted successfully" });
          });
        });
        return;
      }

      if (person.married_family_code) {
        db.run("DELETE FROM families WHERE code=?", [person.married_family_code]);
      }

      db.run("DELETE FROM persons WHERE id=?", [person.id], err5 => {
        if (err5) return res.status(500).json({ error: err5.message });
        res.json({ message: "Person deleted successfully" });
      });
    });
  });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
