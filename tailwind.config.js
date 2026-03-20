/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Roboto Mono', 'monospace'],
      },
      colors: {
        /* 背景色 */
        background: "hsl(var(--background))",
        surface: "hsl(var(--surface))",
        "surface-elevated": "hsl(var(--surface-elevated))",
        overlay: "hsl(var(--overlay))",

        /* 文字色 */
        foreground: "hsl(var(--foreground))",
        "foreground-secondary": "hsl(var(--foreground-secondary))",
        "foreground-muted": "hsl(var(--foreground-muted))",
        "foreground-code": "hsl(var(--foreground-code))",

        /* 边框色 */
        "border-subtle": "hsl(var(--border-subtle))",
        "border-active": "hsl(var(--border-active))",
        "border-focus": "hsl(var(--border-focus))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",

        /* 主要元素 */
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--foreground-muted))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },

        /* 卡片/弹出层 */
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },

        /* 语义色 - 错误 */
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          light: "var(--error-light)",
          border: "var(--error-border)",
        },

        /* 语义色 - 成功 */
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          light: "var(--success-light)",
          border: "var(--success-border)",
        },

        /* 语义色 - 警告 */
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          light: "var(--warning-light)",
          border: "var(--warning-border)",
        },

        /* 灰度梯度 */
        gray: {
          50: "hsl(var(--gray-50))",
          100: "hsl(var(--gray-100))",
          200: "hsl(var(--gray-200))",
          300: "hsl(var(--gray-300))",
          400: "hsl(var(--gray-400))",
          500: "hsl(var(--gray-500))",
          600: "hsl(var(--gray-600))",
          700: "hsl(var(--gray-700))",
          800: "hsl(var(--gray-800))",
          900: "hsl(var(--gray-900))",
          950: "hsl(var(--gray-950))",
        },

        /* 白色透明度 - 核心设计系统 */
        white: {
          95: "rgba(255, 255, 255, 0.95)",
          90: "rgba(255, 255, 255, 0.90)",
          80: "rgba(255, 255, 255, 0.80)",
          70: "rgba(255, 255, 255, 0.70)",
          60: "rgba(255, 255, 255, 0.60)",
          50: "rgba(255, 255, 255, 0.50)",
          40: "rgba(255, 255, 255, 0.40)",
          30: "rgba(255, 255, 255, 0.30)",
          25: "rgba(255, 255, 255, 0.25)",
          20: "rgba(255, 255, 255, 0.20)",
          15: "rgba(255, 255, 255, 0.15)",
          12: "rgba(255, 255, 255, 0.12)",
          10: "rgba(255, 255, 255, 0.10)",
          8: "rgba(255, 255, 255, 0.08)",
          6: "rgba(255, 255, 255, 0.06)",
          4: "rgba(255, 255, 255, 0.04)",
          2: "rgba(255, 255, 255, 0.02)",
        },

        /* Antigravity 遗留兼容 */
        antigravity: {
          black: "#0F1115",
          dark: "#0A0A0A",
          charcoal: "#16181D",
          gray: "#3F4046",
          silver: "#9CA3AF",
          white: "#FFFFFF",
          glass: "rgba(255, 255, 255, 0.02)",
        }
      },

      /* 动画 */
      animation: {
        "float": "float 6s ease-in-out infinite",
        "fade-in": "fade-in 0.5s ease-out forwards",
        "stagger-in": "stagger-in 0.4s ease-out forwards",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "stagger-in": {
          "0%": { opacity: "0", transform: "translateX(-15px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },

      /* 圆角系统 */
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        full: "var(--radius-full)",
      },

      /* 阴影系统 */
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
      },

      /* 间距 */
      spacing: {
        'safe-area-inset-bottom': 'env(safe-area-inset-bottom)',
        'mobile-nav': 'var(--mobile-nav-total)',
      },

      /* 过渡 */
      transitionDuration: {
        fast: '150ms',
        normal: '300ms',
        slow: '500ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}