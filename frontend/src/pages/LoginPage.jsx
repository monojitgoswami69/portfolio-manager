import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { useToast } from '../context/ToastContext';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { addToast } = useToast();

  const from = location.state?.from?.pathname || '/dashboard';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await login(username, password, rememberMe);

      if (result && result.success) {
        addToast({
          action: 'Success',
          message: 'Welcome back!',
          status: 'complete',
        });
        navigate(from, { replace: true });
      } else {
        addToast({
          action: 'Error',
          message: result?.error || 'Invalid credentials',
          status: 'error',
        });
      }
    } catch (err) {
      addToast({
        action: 'Error',
        message: 'An unexpected error occurred',
        status: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  return (
    <div className="login-page min-h-screen flex items-center justify-center p-4 md:p-8 transition-colors duration-300">
      {/* Background */}
      <div className="mountain-bg">
        <img
          alt="Scenic mountain landscape at dawn"
          className="scenic-image"
          src="/login/login_background.webp"
        />
      </div>

      {/* Main Glass Card Container */}
      <div className="w-full max-w-5xl glass-card rounded-card flex flex-col md:flex-row overflow-hidden min-h-[600px] transition-all duration-300">
        
        {/* Left Panel Wrapper */}
        <div className="md:w-[45%] p-3 md:p-4 flex flex-col">
          {/* Floating Inner Card */}
          <div className="relative rounded-[24px] w-full h-full flex flex-col justify-end text-white overflow-hidden shadow-2xl bg-white/10 backdrop-blur-2xl min-h-[300px] md:min-h-0">
            
            {/* Background Image */}
            <img
              src="/login/login_leftcard.webp"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 hover:scale-105 opacity-85"
              alt="Login Visual"
            />

            {/* Soft Gradient Overlay for text readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>

            <div className="relative z-10 p-8 md:p-12 mb-4">
              <h1 className="text-3xl md:text-5xl font-bold leading-tight tracking-tight drop-shadow-sm font-display">
                Welcome to <span className="text-amber-300 font-black tracking-normal">Portfolio Manager</span>
              </h1>
              <p className="mt-6 text-white/90 text-lg font-light leading-relaxed">
                Your all-in-one dashboard for managing projects, knowledge base, and system settings.
              </p>
            </div>
          </div>
        </div>

        {/* Right Panel: Login Form */}
        <div className="md:w-[55%] p-8 md:p-16 flex flex-col justify-center relative">
          <div className="max-w-md mx-auto w-full">
            {/* Header */}
            <div className="mb-10">
              <h2 className="text-3xl font-bold text-slate-800 tracking-tight mb-2 font-display">Welcome back</h2>
              <p className="text-slate-500 text-base">
                Enter your details to access the dashboard
              </p>
            </div>

            {/* Form */}
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <label
                  className="block text-sm font-semibold text-slate-700 mb-2 ml-1"
                  htmlFor="username"
                >
                  Username
                </label>
                <input
                  className="w-full px-4 py-3.5 rounded-xl input-glass text-slate-900 focus:ring-0 transition-all outline-none placeholder-slate-600"
                  id="username"
                  name="username"
                  placeholder="Enter your username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2 ml-1">
                  <label
                    className="block text-sm font-semibold text-slate-700"
                    htmlFor="password"
                  >
                    Password
                  </label>
                </div>
                <div className="relative">
                  <input
                    className="w-full px-4 py-3.5 rounded-xl input-glass text-slate-900 focus:ring-0 transition-all outline-none placeholder-slate-600"
                    id="password"
                    name="password"
                    placeholder="Enter your password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors"
                    type="button"
                    onClick={togglePasswordVisibility}
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Remember Me */}
              <div className="flex items-center space-x-2 mb-2 ml-1">
                <input
                  type="checkbox"
                  id="remember"
                  name="remember"
                  className="w-4 h-4 rounded border-slate-300 bg-white/20 text-primary border-none focus:ring-0 outline-none transition-colors cursor-pointer"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <label
                  htmlFor="remember"
                  className="text-sm font-medium text-slate-600 cursor-pointer select-none"
                >
                  Remember me
                </label>
              </div>

              <button
                className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-4 rounded-xl shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0 text-lg mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  boxShadow: '0 10px 25px -5px rgba(79, 70, 229, 0.3)'
                }}
                type="submit"
                disabled={isLoading}
              >
                {isLoading ? 'Logging in...' : 'Login'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
