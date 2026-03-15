# Kisan ISP Backend

A robust Node.js backend for managing Internet Service Provider (ISP) operations, featuring automated billing synchronization with T-Shul and real-time network provisioning via Radius.

## 🚀 Features

- **Billing Integration**: Automated two-way synchronization with T-Shul for packages and extra charges.
- **Network Provisioning**: Real-time integration with Mikrotik/Radius for plan and user management.
- **Customer Management**: Comprehensive lead and customer lifecycle management.
- **Dynamic Pricing**: Support for various package durations and one-time charges with tax calculations.
- **Payments**: Integration with eSewa (and other future gateways) for seamless subscription renewals.
- **Ticketing System**: Internal support ticketing for customer issues.
- **WebSocket Notifications**: Real-time updates for server and customer events.

## 🛠️ Technology Stack

- **Runtime**: [Node.js](https://nodejs.org/)
- **Framework**: [Express.js](https://expressjs.com/)
- **Database ORM**: [Prisma](https://www.prisma.io/)
- **Database**: MySQL / MariaDB
- **Authentication**: JWT (JSON Web Tokens)
- **Communication**: WebSockets (ws), Axios for REST APIs

## 📋 Prerequisites

- Node.js (v18+)
- MySQL or MariaDB instance
- npm or yarn

## 🔧 Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/karnkalyan/isp-backend.git
   cd isp-backend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory (refer to `.env.example` if available).
   ```env
   DATABASE_URL="mysql://user:password@localhost:3306/isp_db"
   JWT_SECRET="your_secret_key"
   PORT=3200
   ```

4. **Run Database Migrations**:
   ```bash
   npx prisma migrate dev
   ```

5. **Start the Development Server**:
   ```bash
   npm run dev
   ```

## 🏗️ Architecture

### Service Factory Pattern
The core synchronization logic uses a `ServiceFactory` to dynamically instantiate clients (Radius, T-Shul, Yeastar, etc.) based on the ISP's configuration. This allows for multi-tenant service enablement without bloating the controllers.

### Controller Structure
- `packagePlan.controller.js`: Manages internet tiers and Radius group mappings.
- `packagePrice.controller.js`: Handles durations, billing sync, and trial package detection.
- `extraCharges.controller.js`: Manages one-time charges (Installation, Router Rental, etc.) and T-Shul sync.
- `esewa.controller.js`: Orchestrates the payment-to-provisioning flow.

## 🔄 T-Shul Synchronization Logic

The backend implements a resilient "Split Resync" logic:
- **Mbps Category**: Maps to Internet Packages. Matches are made using normalized `ReferenceId` and Plan Names.
- **Psc Category**: Maps to One-Time Charges.
- **Normalization**: Automatically strips spaces/hyphens to ensure matches between local and external systems.
- **Trial Detection**: Any Mbps package with a price of 0 is automatically flagged as a Trial package.

## 📄 License

This project is proprietary and confidential.

---
Built with ❤️ by the Simulcast Technolgoies - Karn Kalyan.
