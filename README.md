# 🚀 InvenTrOps

**Enterprise IT Infrastructure Inventory Platform**

> A modern, scalable, and automation-ready platform for managing enterprise IT infrastructure.
> Centralize your datacenter, storage, network, and compute assets in a single system.

---

## 🧭 Overview

**InvenTrOps** is designed to help enterprise IT teams manage complex infrastructures in a **centralized, secure, and automated** way.

It consolidates systems from multiple vendors (Dell, Huawei, HPE, etc.) into a single platform to:

* Increase infrastructure visibility
* Reduce operational errors
* Enable automation and integration

---

## ✨ Key Features

### 🔐 Security & Access Control

* Strict **RBAC (Role-Based Access Control)**
* Team isolation (Storage / Network / Server / Security)
* LDAP / Active Directory integration
* Team-scoped API authorization
* Forced password change on first login

---

### 🖥️ Asset Management

* Physical assets (servers, switches, storage systems)
* Virtual and software assets
* License tracking
* Vendor and lifecycle management

---

### 🧱 Datacenter Visualization

* Interactive rack designer
* Multi-U device placement
* Collision detection
* Rack-level capacity planning

---

### 📊 Analytics & Reporting

* Real-time inventory insights
* Capacity and growth tracking
* Team-based asset distribution
* Export-ready reports

---

### 🔗 External Integrations

* Dell OpenManage
* HPE OneView
* Xormon Monitoring

➡️ Automatically discover and onboard new infrastructure into inventory.

---

### ⚙️ Automation Ready

* API-first architecture
* Queue-based background processing (BullMQ)
* Event-driven synchronization

---

## 🏗️ Architecture

```text

+----------------+    +----------------+    +----------------+
|   Frontend     | -> |   Backend API  | -> |   PostgreSQL   |
| (React + Vite) |    | (Node.js)      |    |   (Prisma)     |
+----------------+    +--------+-------+    +----------------+
                              |
                              v
                        +-------------+
                        |   Redis     |
                        |  (BullMQ)   |
                        +-------------+
```

---

## 🛠️ Tech Stack

| Layer          | Technology                     |
| -------------- | ------------------------------ |
| Frontend       | React + Vite                   |
| Backend        | Node.js + TypeScript + Express |
| Database       | PostgreSQL (Prisma ORM)        |
| Queue/Cache    | Redis (BullMQ)                 |
| Infrastructure | Docker & Docker Compose        |

---

## 🚀 Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/yourusername/inventrops.git
cd inventrops
```

---

### 2. Environment Configuration

Create a `.env` file inside the `backend` directory:

---

### 3. Run with Docker

```bash
docker compose up -d --build
```

---

### 4. Initialize Database

```bash
docker compose exec backend npx prisma db push --force-reset
docker compose exec backend node dist/scripts/seed.js
```

---

### 5. Access Applications

| Service     | URL                                            |
| ----------- | ---------------------------------------------- |
| User Portal | [http://localhost:5173](http://localhost:5173) |
| Admin Panel | [http://localhost:3001](http://localhost:3001) |

---

## 👤 Default Credentials

---

## 📁 Project Structure

```bash
inventrops/
│
├── backend/        # API, workers, integrations
├── frontend/       # User interface
├── admin-panel/    # Admin dashboard
├── docker-compose.yml
└── README.md
```

---

## 🔒 Security Model

* Team-based data isolation using `team_id`
* API-level authorization
* Encrypted credentials for integrations
* Least privilege access model

---

## 🔄 Roadmap

* [ ] ServiceNow integration
* [ ] Terraform provider
* [ ] Advanced alerting system
* [ ] AI-based capacity forecasting
* [ ] Multi-datacenter topology visualization

---

## 🤝 Contributing

Contributions are welcome:

```bash
fork → create branch → commit → open PR 🚀
```

---

## 📄 License

This project is licensed under the MIT License.

---

## 💡 Vision

> "To unify enterprise IT operations into a single platform and enable automation-first infrastructure management."
