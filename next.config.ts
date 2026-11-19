import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["imapflow", "mailparser", "nodemailer"],
  poweredByHeader: false,
};

export default nextConfig;
