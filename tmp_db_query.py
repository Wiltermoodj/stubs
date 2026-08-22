import sqlite3
con = sqlite3.connect('.kanban/kanban.db')
c = con.cursor()
c.execute("SELECT id, title, status, assignee, result FROM tasks WHERE id LIKE 't_stub0%' ORDER BY id")
for r in c.fetchall():
    print(r)