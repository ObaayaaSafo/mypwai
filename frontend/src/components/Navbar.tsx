import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import './Navbar.css';
import { useTheme } from '../ThemeContext';

const Navbar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const userRole = localStorage.getItem('userRole');
  
  const { theme, toggleTheme } = useTheme();

  const getLinkClass = (path: string) => {
    return location.pathname === path ? 'nav-link active' : 'nav-link';
  };

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userRole');
    localStorage.removeItem('username');
    localStorage.removeItem('email');
    navigate('/');
  };

  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <nav className="navbar">
      <div className="navbar-brand">ExamSys</div>

      <button className="nav-toggle" onClick={() => setOpen(v => !v)} aria-label="Toggle navigation">
        <span aria-hidden="true">{open ? '×' : '☰'}</span>
      </button>

      <div className={`navbar-nav ${open ? 'mobile-open' : ''}`} onClick={close}>
        <Link to="/dashboard" className={getLinkClass('/dashboard')}>Dashboard</Link>
        {userRole === 'admin' && <Link to="/students" className={getLinkClass('/students')}>Students</Link>}
        {userRole === 'admin' && <Link to="/enroll" className={getLinkClass('/enroll')}>Enrollment</Link>}
        <Link to="/exam-setup" className={getLinkClass('/exam-setup')}>Exams</Link>
        <Link to="/attendance" className={getLinkClass('/attendance')}>Attendance</Link>
        <Link to="/monitoring" className={getLinkClass('/monitoring')}>Monitoring</Link>
        <Link to="/reporting" className={getLinkClass('/reporting')}>Reports</Link>
        {userRole === 'admin' && (
          <Link to="/invigilators" className={getLinkClass('/invigilators')}>Invigilators</Link>
        )}
        <button onClick={handleLogout} className="nav-link logout">Logout</button>
        <button
          onClick={toggleTheme}
          className="theme-toggle"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
