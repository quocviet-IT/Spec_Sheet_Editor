export const vi = {
  app: {
    name: "Spec Sheet Editor",
    tagline: "Sửa số kích thước trên phiếu Product Specifications",
  },
  common: {
    signOut: "Đăng xuất",
    language: "Ngôn ngữ",
    admin: "Quản trị",
    sheets: "Phiếu",
  },
  login: {
    title: "Đăng nhập",
    lead: "Dùng tài khoản Google công ty.",
    google: "Đăng nhập bằng Google",
    errors: {
      notPermitted: "Tài khoản Google này không thuộc tên miền được phép. Hãy đăng nhập bằng email công ty.",
      suspended: "Tài khoản của bạn đã bị khoá. Liên hệ quản trị viên.",
      google: "Không đăng nhập được với Google. Thử lại.",
    },
  },
  sheets: {
    title: "Phiếu",
    empty: "Chưa có phiếu nào.",
  },
  admin: {
    title: "Quản trị",
    lead: "Chỉ quản trị viên thấy khu này.",
    areas: {
      users: "Người dùng",
      access: "Truy cập và cấu hình",
      audit: "Nhật ký hoạt động",
      cleanup: "Thùng rác và dọn dẹp",
    },
  },
} as const;
