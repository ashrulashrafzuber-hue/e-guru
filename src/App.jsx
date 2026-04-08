import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Clock, MapPin, User, BookOpen, Upload, 
  CheckCircle, AlertCircle, XCircle, Plus, Edit, 
  Trash2, Settings, ChevronRight, Calendar, Users, Briefcase, ArrowLeft,
  Repeat, UserCheck, UserMinus, FileText
} from 'lucide-react';
import { 
  initializeApp 
} from 'firebase/app';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, collection, onSnapshot, doc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch 
} from 'firebase/firestore';

// --- INITIALIZE FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyBTOJTrWniPvKZaky9h357CWyNJcKFjg8c",
  authDomain: "dashboard-guru-81e7d.firebaseapp.com",
  projectId: "dashboard-guru-81e7d",
  storageBucket: "dashboard-guru-81e7d.firebasestorage.app",
  messagingSenderId: "54865763507",
  appId: "1:54865763507:web:9bba7babde139bae8e24c6",
  measurementId: "G-H6CVZMGJ12"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'teacher-dashboard-id';

// --- HELPER UNTUK HARI INI ---
const DAYS = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
const getTodayDayString = () => DAYS[new Date().getDay()];
const getTodayDateString = () => new Date().toLocaleDateString('en-CA');

const timeToMins = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

// --- MAIN APP COMPONENT ---
export default function App() {
  const [user, setUser] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [kelasGanti, setKelasGanti] = useState([]);
  const [ketiadaan, setKetiadaan] = useState([]); // STATE BARU: Rekod masa ketiadaan guru
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const [currentView, setCurrentView] = useState('dashboard'); // 'dashboard' | 'admin'
  const [selectedTeacher, setSelectedTeacher] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Authenticate & Setup Real-time Listeners
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          try {
            await signInWithCustomToken(auth, __initial_auth_token);
          } catch (tokenError) {
            console.warn("Token mismatch. Bertukar ke log masuk Anonymous...", tokenError);
            await signInAnonymously(auth);
          }
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });

    // Load PDF.js dynamically for parsing
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
    document.body.appendChild(script);

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) return;

    const teachersRef = collection(db, 'artifacts', appId, 'users', user.uid, 'guru');
    const schedulesRef = collection(db, 'artifacts', appId, 'users', user.uid, 'jadual');
    const reliefRef = collection(db, 'artifacts', appId, 'users', user.uid, 'kelas_ganti');
    const ketiadaanRef = collection(db, 'artifacts', appId, 'users', user.uid, 'ketiadaan');

    const unsubTeachers = onSnapshot(teachersRef, (snapshot) => {
      setTeachers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => console.error(error));

    const unsubSchedules = onSnapshot(schedulesRef, (snapshot) => {
      setSchedules(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => console.error(error));

    const unsubRelief = onSnapshot(reliefRef, (snapshot) => {
      setKelasGanti(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => console.error(error));

    const unsubKetiadaan = onSnapshot(ketiadaanRef, (snapshot) => {
      setKetiadaan(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => console.error(error));

    return () => {
      unsubTeachers();
      unsubSchedules();
      unsubRelief();
      unsubKetiadaan();
    };
  }, [user]);

  // 2. Timer untuk Auto-Update Status
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 10000); 
    return () => clearInterval(timer);
  }, []);

  // --- LOGIC: TENTUKAN STATUS GURU ---
  const getTeacherLiveStatus = (teacher) => {
    const todayDateStr = getTodayDateString();
    const todayStr = getTodayDayString();
    const currentMins = currentTime.getHours() * 60 + currentTime.getMinutes();

    // 1. Semak rekod ketiadaan (Override Masa Tertentu)
    const absences = ketiadaan.filter(k => k.guru_id === teacher.id && k.tarikh === todayDateStr);
    for (let abs of absences) {
      const absStart = timeToMins(abs.masa_mula);
      const absEnd = timeToMins(abs.masa_tamat);
      if (currentMins >= absStart && currentMins < absEnd) {
        return { 
          status: abs.sebab || 'Tidak Hadir', 
          location: abs.lokasi || '-',
          isManual: true 
        };
      }
    }

    // 2. Semak jadual kelas semasa
    const todaySlots = schedules.filter(s => s.guru_id === teacher.id && s.hari === todayStr);

    for (let slot of todaySlots) {
      if(!slot.masa_mula || !slot.masa_tamat) continue;
      const [startH, startM] = slot.masa_mula.split(':').map(Number);
      const [endH, endM] = slot.masa_tamat.split(':').map(Number);
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;

      if (currentMins >= startMins && currentMins < endMins) {
        return { 
          status: 'Mengajar', 
          location: slot.lokasi || slot.kelas || 'Bilik Darjah',
          slotInfo: slot,
          isManual: false 
        };
      }
    }

    return { 
      status: 'Rehat / Tiada Kelas', 
      location: 'Bilik Guru',
      isManual: false 
    };
  };

  // --- RENDER HELPERS ---
  const getStatusColor = (status) => {
    if (status === 'Mengajar') return 'bg-green-100 text-green-700 border-green-200';
    if (status === 'Rehat / Tiada Kelas') return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    if (status === 'Tidak Hadir') return 'bg-red-100 text-red-700 border-red-200';
    return 'bg-blue-100 text-blue-700 border-blue-200'; // Untuk Cuti/Mesyuarat dll
  };

  const getStatusIcon = (status) => {
    if (status === 'Mengajar') return <CheckCircle className="w-4 h-4 mr-1" />;
    if (status === 'Tidak Hadir') return <XCircle className="w-4 h-4 mr-1" />;
    return <AlertCircle className="w-4 h-4 mr-1" />;
  };

  // --- STATS ---
  const stats = useMemo(() => {
    let mengajar = 0; let rehat = 0; let tidakHadir = 0;
    teachers.forEach(t => {
      const { status } = getTeacherLiveStatus(t);
      if (status === 'Mengajar') mengajar++;
      else if (status === 'Tidak Hadir') tidakHadir++;
      else rehat++;
    });
    return { total: teachers.length, mengajar, rehat, tidakHadir };
  }, [teachers, schedules, currentTime]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans">
      {/* HEADER NAVBAR */}
      <nav className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-20 flex flex-col sm:flex-row justify-between items-center shadow-sm">
        <div className="flex items-center mb-4 sm:mb-0">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white mr-3">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">Dashboard Pergerakan Guru</h1>
            <p className="text-sm text-gray-500 font-medium">Sistem Pemantauan Masa Nyata</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="bg-gray-100 px-4 py-2 rounded-full flex items-center text-sm font-semibold text-gray-700 border border-gray-200">
            <Clock className="w-4 h-4 mr-2 text-indigo-500" />
            {currentTime.toLocaleDateString('ms-MY', { weekday: 'long', day: 'numeric', month: 'short' })} • 
            <span className="ml-1 text-indigo-700">{currentTime.toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button 
              onClick={() => setCurrentView('dashboard')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${currentView === 'dashboard' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Utama
            </button>
            <button 
              onClick={() => setCurrentView('admin')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center ${currentView === 'admin' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Settings className="w-4 h-4 mr-1" /> Admin
            </button>
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT AREA */}
      <main className="p-6 max-w-7xl mx-auto">
        {!user ? (
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
            <p className="mt-4 text-gray-500">Memuatkan sistem...</p>
          </div>
        ) : (
          <>
            {currentView === 'dashboard' && (
              <div className="space-y-6">
                
                {/* Stats Row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard title="Jumlah Guru" value={stats.total} icon={<Users />} color="bg-indigo-50" textColor="text-indigo-600" />
                  <StatCard title="Sedang Mengajar" value={stats.mengajar} icon={<BookOpen />} color="bg-green-50" textColor="text-green-600" />
                  <StatCard title="Rehat / Tiada Kelas" value={stats.rehat} icon={<Clock />} color="bg-yellow-50" textColor="text-yellow-600" />
                  <StatCard title="Tidak Hadir" value={stats.tidakHadir} icon={<XCircle />} color="bg-red-50" textColor="text-red-600" />
                </div>

                {/* RELIEF CLASSES (KELAS GANTI) DISPLAY */}
                {kelasGanti.filter(kg => kg.tarikh === getTodayDateString()).length > 0 && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 shadow-sm">
                    <h3 className="text-lg font-bold text-indigo-900 flex items-center mb-4">
                      <Repeat className="w-5 h-5 mr-2 text-indigo-600" /> Maklumat Kelas Ganti (Relief) Hari Ini
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {kelasGanti
                        .filter(kg => kg.tarikh === getTodayDateString())
                        .map(kg => {
                          const guruAsal = teachers.find(t => t.id === kg.guru_asal_id);
                          const guruGanti = teachers.find(t => t.id === kg.guru_ganti_id);
                          const slot = schedules.find(s => s.id === kg.jadual_id);
                          if (!guruAsal || !guruGanti || !slot) return null;
                          
                          return (
                            <div key={kg.id} className="bg-white p-4 rounded-lg border border-indigo-100 shadow-sm relative overflow-hidden">
                              <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-500"></div>
                              <div className="flex justify-between items-start pl-2 mb-2">
                                <div>
                                  <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded">Asal: {guruAsal.nama}</span>
                                </div>
                                <div className="text-xs font-bold text-gray-800 bg-gray-100 px-2 py-1 rounded shadow-sm border border-gray-200">
                                  {slot.masa_mula} - {slot.masa_tamat}
                                </div>
                              </div>
                              <div className="pl-2 mb-3 mt-1">
                                <p className="font-bold text-lg text-gray-900">{slot.kelas}</p>
                                <p className="text-sm text-gray-500 font-medium">{slot.subjek} • {slot.lokasi}</p>
                              </div>
                              <div className="pl-2 flex items-center bg-green-50 p-2.5 rounded-lg border border-green-100">
                                <UserCheck className="w-4.5 h-4.5 mr-2 text-green-600" />
                                <span className="text-sm font-medium text-green-800">Ganti: <span className="font-bold">{guruGanti.nama}</span></span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {teachers.length === 0 && (
                  <div className="bg-white p-8 text-center rounded-xl border border-gray-200 border-dashed">
                    <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <h3 className="text-lg font-medium text-gray-900">Tiada Data Guru</h3>
                    <p className="text-gray-500 mt-1 mb-4">Sila muat naik jadual PDF di panel Admin atau jana data demo.</p>
                  </div>
                )}

                {/* Search & Filter */}
                {teachers.length > 0 && (
                  <div className="flex flex-col sm:flex-row justify-between items-center mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                    <div className="relative w-full sm:w-96">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                      <input 
                        type="text" 
                        placeholder="Cari nama guru atau subjek..." 
                        className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-shadow"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {/* Teacher Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {teachers
                    .filter(t => t.nama.toLowerCase().includes(searchQuery.toLowerCase()) || t.subjek.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map(teacher => {
                      const liveData = getTeacherLiveStatus(teacher);
                      return (
                        <div 
                          key={teacher.id} 
                          onClick={() => setSelectedTeacher(teacher)}
                          className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer relative overflow-hidden group"
                        >
                          <div className={`absolute top-0 left-0 w-1.5 h-full ${liveData.status === 'Mengajar' ? 'bg-green-500' : liveData.status === 'Tidak Hadir' ? 'bg-red-500' : 'bg-yellow-500'}`}></div>
                          
                          <div className="flex justify-between items-start mb-3 pl-2">
                            <div>
                              <h3 className="text-lg font-bold text-gray-900">{teacher.nama}</h3>
                              <p className="text-sm text-gray-500 font-medium">{teacher.subjek}</p>
                            </div>
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${getStatusColor(liveData.status)}`}>
                              {getStatusIcon(liveData.status)}
                              {liveData.status}
                            </span>
                          </div>

                          <div className="bg-gray-50 rounded-lg p-3 mt-4 border border-gray-100 pl-2">
                            <div className="flex items-center text-sm text-gray-700 mb-2">
                              <MapPin className="w-4 h-4 mr-2 text-indigo-500" />
                              <span className="font-medium">Lokasi:</span>
                              <span className="ml-2 bg-white px-2 py-0.5 rounded border border-gray-200 shadow-sm">{liveData.location}</span>
                            </div>
                            {liveData.slotInfo && (
                              <div className="flex items-center text-sm text-gray-600">
                                <Clock className="w-4 h-4 mr-2 text-gray-400" />
                                <span>Kelas: {liveData.slotInfo.kelas} ({liveData.slotInfo.masa_mula} - {liveData.slotInfo.masa_tamat})</span>
                              </div>
                            )}
                          </div>
                          
                          {liveData.isManual && (
                            <div className="mt-3 text-xs text-right text-gray-400 italic">
                              *Status diubah manual
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {currentView === 'admin' && (
              <AdminPanel 
                user={user} 
                db={db} 
                appId={appId} 
                teachers={teachers} 
                schedules={schedules}
                kelasGanti={kelasGanti}
                ketiadaan={ketiadaan}
                getTodayDayString={getTodayDayString}
              />
            )}
          </>
        )}
      </main>

      {/* MODAL DETAIL GURU */}
      {selectedTeacher && (
        <TeacherDetailModal 
          teacher={selectedTeacher} 
          schedules={schedules.filter(s => s.guru_id === selectedTeacher.id)}
          onClose={() => setSelectedTeacher(null)} 
          liveData={getTeacherLiveStatus(selectedTeacher)}
          getStatusColor={getStatusColor}
        />
      )}
    </div>
  );
}

// --- STAT CARD COMPONENT ---
function StatCard({ title, value, icon, color, textColor }) {
  return (
    <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center">
      <div className={`p-3 rounded-lg ${color} ${textColor} mr-4`}>
        {icon}
      </div>
      <div>
        <p className="text-sm text-gray-500 font-medium">{title}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

// --- MODAL COMPONENT ---
function TeacherDetailModal({ teacher, schedules, onClose, liveData, getStatusColor }) {
  const dayOrder = ['Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu', 'Ahad'];
  const todayStr = getTodayDayString();

  // Kumpulkan jadual mengikut hari dan susun mengikut masa
  const groupedSchedules = {};
  dayOrder.forEach(day => {
    const daySchedules = schedules
      .filter(s => s.hari === day)
      .sort((a, b) => a.masa_mula.localeCompare(b.masa_mula));
    
    if (daySchedules.length > 0) {
      groupedSchedules[day] = daySchedules;
    }
  });

  const activeDays = Object.keys(groupedSchedules);

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex justify-between items-start bg-gray-50">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">{teacher.nama}</h2>
            <div className="flex items-center space-x-3">
              <span className="text-gray-600 flex items-center"><Briefcase className="w-4 h-4 mr-1"/> {teacher.subjek}</span>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getStatusColor(liveData.status)}`}>
                {liveData.status}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 bg-white rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition">
            <XCircle className="w-6 h-6" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1">
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-6 flex items-center">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mr-4 text-indigo-500">
              <MapPin className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-indigo-900">Lokasi Semasa</p>
              <p className="text-lg font-bold text-indigo-700">{liveData.location}</p>
            </div>
          </div>

          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
            <Calendar className="w-5 h-5 mr-2 text-gray-500" />
            Jadual Penuh Mingguan
          </h3>
          
          {activeDays.length > 0 ? (
            <div className="space-y-6">
              {activeDays.map(day => (
                <div key={day} className={`overflow-hidden border ${day === todayStr ? 'border-indigo-300 shadow-sm' : 'border-gray-200'} rounded-xl`}>
                  <div className={`px-4 py-2 border-b flex justify-between items-center ${day === todayStr ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-200'}`}>
                    <h4 className={`font-bold ${day === todayStr ? 'text-indigo-800' : 'text-gray-700'}`}>{day}</h4>
                    {day === todayStr && (
                      <span className="text-xs font-bold bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full uppercase tracking-wider">
                        Hari Ini
                      </span>
                    )}
                  </div>
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-white">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-semibold text-gray-500 text-xs uppercase tracking-wider">Masa</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-gray-500 text-xs uppercase tracking-wider">Kelas</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-gray-500 text-xs uppercase tracking-wider">Subjek</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-gray-500 text-xs uppercase tracking-wider">Lokasi</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {groupedSchedules[day].map((slot, idx) => {
                        const isCurrent = liveData.slotInfo && liveData.slotInfo.id === slot.id;
                        return (
                          <tr key={idx} className={isCurrent ? 'bg-green-50' : 'hover:bg-gray-50 transition-colors'}>
                            <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900">
                              {slot.masa_mula} - {slot.masa_tamat}
                            </td>
                            <td className="px-4 py-3 text-gray-700 font-medium">{slot.kelas}</td>
                            <td className="px-4 py-3 text-gray-500">{slot.subjek}</td>
                            <td className="px-4 py-3 text-gray-700 flex items-center">
                              {isCurrent && <span className="w-2.5 h-2.5 rounded-full bg-green-500 mr-2 animate-pulse shadow-sm"></span>}
                              {slot.lokasi}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center p-8 bg-gray-50 rounded-xl border border-gray-200">
              <p className="text-gray-500">Tiada rekod jadual untuk guru ini.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- ADMIN PANEL COMPONENT ---
function AdminPanel({ user, db, appId, teachers, schedules, kelasGanti, ketiadaan, getTodayDayString }) {
  const [activeTab, setActiveTab] = useState('guru'); // 'guru' | 'upload' | 'relief'
  const [managingScheduleFor, setManagingScheduleFor] = useState(null); // ID guru untuk urusan jadual
  const [managingAbsenceFor, setManagingAbsenceFor] = useState(null); // ID guru untuk ketiadaan masa spesifik
  
  // AI Upload States
  const [isProcessing, setIsProcessing] = useState(false);
  const [parseResult, setParseResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  
  // State Baru untuk Mod Tampal Teks
  const [uploadMethod, setUploadMethod] = useState('pdf'); // 'pdf' | 'text'
  const [manualText, setManualText] = useState('');

  // --- KOD AI GEMINI YANG DIKONGSI BERSAMA (PDF & TEKS) ---
  const processWithAI = async (textToProcess) => {
    setIsProcessing(true);
    setErrorMsg('');
    setParseResult(null);

    try {
      // --- AUTODETECT PERSEKITARAN ---
      // Sistem kenal pasti sama ada ia diuji di skrin ini (Canvas) atau di Internet (Vercel)
      const isPreviewEnv = typeof __app_id !== 'undefined';
      const apiKey = isPreviewEnv ? "" : "AIzaSyAbyj3Kkvw_zaWBUYbpN0DPIA0XO2oBNsk"; 
      const modelName = isPreviewEnv ? "gemini-2.5-flash-preview-09-2025" : "gemini-1.5-flash";

      const systemPrompt = `
      Anda adalah pakar penganalisis data jadual waktu sekolah (OCR + NLP) yang sangat tepat.
      Teks di bawah adalah data jadual waktu sekolah.
      
      TUGAS ANDA:
      Baca teks tersebut, fahami lajur masa (cth: 07:30 - 08:00) dan baris hari (cth: Isnin, Selasa).
      Kenal pasti nama guru dan subjek utama mereka.
      Bina rekod jadual berstruktur bagi setiap kelas yang diajar. Abaikan waktu rehat (REHAT) atau perhimpunan jika tiada kelas spesifik.
      
      FORMAT OUTPUT (JSON SAHAJA Tanpa backticks markdown):
      {
        "guru": [
          {"nama": "Nama Penuh Guru (Cari di bahagian atas jadual atau footer)", "subjek": "Subjek Dominan"}
        ],
        "jadual": [
          {
            "guru_nama": "Mesti padan tepat dengan nama di atas",
            "hari": "Isnin/Selasa/Rabu/Khamis/Jumaat", 
            "masa_mula": "HH:mm (format 24-jam, cth: 07:30)", 
            "masa_tamat": "HH:mm (format 24-jam, cth: 08:30)", 
            "kelas": "Nama Kelas (cth: 5 AMANAH)", 
            "subjek": "Nama Subjek (cth: MATEMATIK)", 
            "lokasi": "Bilik Darjah / Makmal / Padang (Letak 'Bilik Darjah' jika tidak pasti)"
          }
        ]
      }
      
      PANDUAN PENTING UNTUK KETEPATAN:
      1. Jika sel mengandungi cantuman Kelas & Subjek (cth: "5 AMANAH MATEMATIK" atau "5A / MT"), pisahkan dengan bijak.
      2. Gabungkan slot masa yang berturutan untuk subjek dan kelas yang sama.
      3. Singkatan hari: ISN=Isnin, SEL=Selasa, RAB=Rabu, KHA=Khamis, JUM=Jumaat.
      4. Abaikan garisan kosong atau teks yang tidak relevan.
      `;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `TEKS JADUAL WAKTU:\n${textToProcess.substring(0, 8000)}` }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Butiran Ralat API Gemini:", errorData);
        throw new Error(errorData.error?.message || "Ralat Pelayan Gemini.");
      }

      const result = await response.json();
      const rawJsonText = result.candidates[0].content.parts[0].text;
      const parsedData = JSON.parse(rawJsonText);
      
      setParseResult(parsedData);
    } catch (err) {
      console.error("Ralat penuh:", err);
      setErrorMsg("Gagal memproses data dengan AI. Sila pastikan teks jadual tidak terlalu panjang.");
    } finally {
      setIsProcessing(false);
    }
  };

  // --- PDF UPLOAD LOGIC ---
  const handlePdfUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== 'application/pdf') {
      setErrorMsg("Sila muat naik fail PDF yang sah.");
      return;
    }

    setIsProcessing(true);
    try {
      const pdfjsLib = window['pdfjs-dist/build/pdf'];
      if (!pdfjsLib) throw new Error("PDF Library belum sedia. Sila cuba sebentar lagi.");
      
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
      
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      let extractedText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        
        const items = content.items.map(item => ({
          str: item.str.trim(),
          x: item.transform[4],
          y: item.transform[5]
        })).filter(item => item.str.length > 0);

        items.sort((a, b) => {
          if (Math.abs(a.y - b.y) > 5) {
            return b.y - a.y; 
          }
          return a.x - b.x;
        });

        let currentY = null;
        let pageText = "";
        for (const item of items) {
          if (currentY === null || Math.abs(currentY - item.y) > 5) {
            pageText += "\n"; 
            currentY = item.y;
          } else {
            pageText += " \t| "; 
          }
          pageText += item.str;
        }
        extractedText += pageText + "\n\n--- MUKA SURAT SETERUSNYA ---\n\n";
      }

      // Hantar teks PDF yang telah diekstrak ke Gemini
      await processWithAI(extractedText);

    } catch (err) {
      console.error(err);
      setErrorMsg("Ralat mengekstrak PDF: " + err.message);
      setIsProcessing(false);
    }
  };

  // --- MANUAL TEXT SUBMIT LOGIC ---
  const handleTextSubmit = () => {
    if (!manualText.trim()) {
      setErrorMsg("Sila masukkan jadual dalam bentuk teks terlebih dahulu.");
      return;
    }
    processWithAI(manualText);
  };

  const simpanDataAi = async () => {
    if (!parseResult) return;
    setIsProcessing(true);
    try {
      const guruIdMap = {};
      const batch = writeBatch(db);

      // 1. Simpan Guru
      for (const g of parseResult.guru) {
        const existingTeacher = teachers.find(t => t.nama.toLowerCase() === g.nama.toLowerCase());
        let guruId;
        if (existingTeacher) {
          guruId = existingTeacher.id;
        } else {
          const newDocRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'guru'));
          batch.set(newDocRef, { nama: g.nama, subjek: g.subjek });
          guruId = newDocRef.id;
        }
        guruIdMap[g.nama] = guruId;
      }

      // 2. Simpan Jadual
      for (const j of parseResult.jadual) {
        const guruId = guruIdMap[j.guru_nama];
        if (guruId) {
          const newDocRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'jadual'));
          batch.set(newDocRef, {
            guru_id: guruId,
            hari: j.hari,
            masa_mula: j.masa_mula,
            masa_tamat: j.masa_tamat,
            kelas: j.kelas,
            subjek: j.subjek,
            lokasi: j.lokasi || 'Bilik Darjah'
          });
        }
      }

      await batch.commit();

      setParseResult(null);
      setManualText('');
      setActiveTab('guru');
      setErrorMsg("Data jadual berjaya disimpan ke pangkalan data!"); 
      setTimeout(() => setErrorMsg(''), 4000);
    } catch (e) {
      console.error(e);
      setErrorMsg("Gagal menyimpan ke pangkalan data.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Jika admin sedang menguruskan ketiadaan
  if (managingAbsenceFor) {
    const teacherToManage = teachers.find(t => t.id === managingAbsenceFor);
    return (
      <AbsenceManager 
        teacher={teacherToManage} ketiadaan={ketiadaan} 
        onBack={() => setManagingAbsenceFor(null)} db={db} appId={appId} user={user} 
      />
    );
  }

  // Jika admin sedang menguruskan jadual guru tertentu
  if (managingScheduleFor) {
    const teacherToManage = teachers.find(t => t.id === managingScheduleFor);
    return (
      <ScheduleManager 
        teacher={teacherToManage} 
        schedules={schedules} 
        onBack={() => setManagingScheduleFor(null)} 
        db={db} 
        appId={appId} 
        user={user} 
      />
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[600px]">
      <div className="flex border-b border-gray-200 bg-gray-50">
        <button 
          onClick={() => setActiveTab('guru')} 
          className={`px-6 py-4 font-medium text-sm flex items-center transition ${activeTab === 'guru' ? 'bg-white border-b-2 border-indigo-500 text-indigo-600' : 'text-gray-500 hover:text-gray-800'}`}
        >
          <Users className="w-4 h-4 mr-2" /> Senarai Guru & Status
        </button>
        <button 
          onClick={() => setActiveTab('relief')} 
          className={`px-6 py-4 font-medium text-sm flex items-center transition ${activeTab === 'relief' ? 'bg-white border-b-2 border-indigo-500 text-indigo-600' : 'text-gray-500 hover:text-gray-800'}`}
        >
          <Repeat className="w-4 h-4 mr-2" /> Guru Ganti (Relief)
        </button>
        <button 
          onClick={() => setActiveTab('upload')} 
          className={`px-6 py-4 font-medium text-sm flex items-center transition ${activeTab === 'upload' ? 'bg-white border-b-2 border-indigo-500 text-indigo-600' : 'text-gray-500 hover:text-gray-800'}`}
        >
          <Upload className="w-4 h-4 mr-2" /> Muat Naik Data AI (PDF/Teks)
        </button>
      </div>

      <div className="p-6">
        {activeTab === 'guru' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-gray-900">Pengurusan Guru (Jadual & Ketiadaan Masa)</h3>
            </div>
            
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Nama Guru</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Subjek</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Tindakan</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200 text-sm">
                  {teachers.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium text-gray-900">{t.nama}</td>
                      <td className="px-6 py-4 text-gray-500">{t.subjek}</td>
                      <td className="px-6 py-4 flex justify-end space-x-3">
                        <button 
                          onClick={() => setManagingAbsenceFor(t.id)}
                          className="text-orange-600 hover:text-orange-800 font-medium flex items-center text-sm bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition"
                        >
                          <Clock className="w-4 h-4 mr-2" /> Ketiadaan
                        </button>
                        <button 
                          onClick={() => setManagingScheduleFor(t.id)}
                          className="text-indigo-600 hover:text-indigo-800 font-medium flex items-center text-sm bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
                        >
                          <Calendar className="w-4 h-4 mr-2" /> Urus Jadual
                        </button>
                      </td>
                    </tr>
                  ))}
                  {teachers.length === 0 && (
                    <tr><td colSpan="3" className="px-6 py-8 text-center text-gray-500">Tiada rekod. Sila muat naik jadual.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'upload' && (
          <div className="max-w-3xl mx-auto py-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-600">
                <Upload className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Muat Naik Data Jadual</h2>
              <p className="text-gray-500">Sistem AI akan membaca dan mengekstrak maklumat secara automatik.</p>
            </div>

            {!parseResult ? (
              <>
                <div className="flex justify-center space-x-4 mb-8">
                  <button 
                    onClick={() => setUploadMethod('pdf')} 
                    className={`px-5 py-2.5 rounded-lg font-bold flex items-center transition ${uploadMethod === 'pdf' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    <Upload className="w-4 h-4 mr-2" /> Muat Naik fail PDF
                  </button>
                  <button 
                    onClick={() => setUploadMethod('text')} 
                    className={`px-5 py-2.5 rounded-lg font-bold flex items-center transition ${uploadMethod === 'text' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    <FileText className="w-4 h-4 mr-2" /> Tampal Teks Manual
                  </button>
                </div>

                {uploadMethod === 'pdf' && (
                  <div className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center hover:bg-gray-50 transition bg-white relative">
                    <input 
                      type="file" 
                      accept=".pdf" 
                      onChange={handlePdfUpload} 
                      disabled={isProcessing}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" 
                    />
                    {isProcessing ? (
                      <div className="space-y-4">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mx-auto"></div>
                        <p className="text-indigo-600 font-medium">AI sedang memproses dokumen PDF...</p>
                        <p className="text-sm text-gray-400">Proses OCR dan NLP sedang berjalan</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-gray-700 font-medium mb-1">Klik atau seret fail PDF ke sini</p>
                        <p className="text-sm text-gray-400">Sokong format jadual standard sekolah</p>
                        <button className="mt-4 px-4 py-2 bg-indigo-50 text-indigo-700 font-medium rounded-lg pointer-events-none">
                          Pilih Fail PDF
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {uploadMethod === 'text' && (
                  <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                    <label className="block text-sm font-bold text-gray-700 mb-2">
                      Tampal data jadual di sini (dari Excel, Word, atau Salinan Web):
                    </label>
                    <textarea 
                      className="w-full h-56 border border-gray-300 rounded-lg p-4 focus:ring-2 focus:ring-indigo-500 focus:outline-none mb-4 text-sm bg-gray-50 text-gray-800"
                      placeholder="Contoh:&#10;Hari | Masa | Kelas | Subjek&#10;Isnin | 07:30 - 08:30 | 5 Amanah | Matematik&#10;Selasa | 09:00 - 10:00 | 4 Bestari | Sains"
                      value={manualText}
                      onChange={(e) => setManualText(e.target.value)}
                      disabled={isProcessing}
                    ></textarea>
                    
                    {isProcessing ? (
                      <div className="flex justify-center items-center py-3 bg-indigo-50 rounded-xl border border-indigo-100">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600 mr-3"></div>
                        <p className="text-indigo-700 font-bold text-sm">AI sedang membaca dan menyusun jadual teks...</p>
                      </div>
                    ) : (
                      <button 
                        onClick={handleTextSubmit}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl shadow-md transition"
                      >
                        Bina Jadual dari Teks Ini
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-100">
                  <h3 className="font-bold text-lg text-green-700 flex items-center">
                    <CheckCircle className="w-5 h-5 mr-2" /> Pengekstrakan Berjaya
                  </h3>
                  <button onClick={() => setParseResult(null)} className="text-gray-400 hover:text-gray-600 text-sm font-medium">Batal</button>
                </div>
                
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                    <p className="text-sm text-gray-500 mb-1">Guru Ditemui</p>
                    <p className="text-2xl font-bold text-gray-900">{parseResult.guru.length}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                    <p className="text-sm text-gray-500 mb-1">Slot Jadual Diekstrak</p>
                    <p className="text-2xl font-bold text-gray-900">{parseResult.jadual.length}</p>
                  </div>
                </div>

                <div className="bg-blue-50 text-blue-800 p-4 rounded-lg text-sm mb-6 flex items-start">
                  <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" />
                  <p>Sila semak jumlah guru dan slot. AI membuat tekaan terbaik (best-effort) berdasarkan corak teks. Klik butang di bawah untuk masukkan data ini ke pangkalan data.</p>
                </div>

                <button 
                  onClick={simpanDataAi}
                  disabled={isProcessing}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl shadow-md transition disabled:opacity-50"
                >
                  {isProcessing ? 'Menyimpan...' : 'Simpan Data ke Sistem'}
                </button>
              </div>
            )}

            {errorMsg && (
              <div className="mt-4 p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl flex items-center">
                <AlertCircle className="w-5 h-5 mr-2" />
                {errorMsg}
              </div>
            )}
          </div>
        )}

        {activeTab === 'relief' && (
          <ReliefManager 
            user={user} db={db} appId={appId} 
            teachers={teachers} schedules={schedules} kelasGanti={kelasGanti} ketiadaan={ketiadaan}
            getTodayDayString={getTodayDayString}
          />
        )}
      </div>
    </div>
  );
}

// --- RELIEF MANAGER COMPONENT ---
function ReliefManager({ user, db, appId, teachers, schedules, kelasGanti, ketiadaan, getTodayDayString }) {
  const [selectedDate, setSelectedDate] = useState(getTodayDateString());
  
  // Get day of week from selected date
  const selectedDayName = useMemo(() => {
    const d = new Date(selectedDate);
    return DAYS[d.getDay()];
  }, [selectedDate]);

  // Cari guru yang ada rekod ketiadaan pada tarikh dipilih (Waktu Spesifik)
  const absentTeachersData = useMemo(() => {
    const absOnDate = ketiadaan.filter(k => k.tarikh === selectedDate);
    const absentIds = [...new Set(absOnDate.map(k => k.guru_id))];
    
    return teachers.filter(t => absentIds.includes(t.id)).map(t => ({
      ...t,
      absences: absOnDate.filter(k => k.guru_id === t.id)
    }));
  }, [teachers, ketiadaan, selectedDate]);

  const saveRelief = async (jadualId, guruAsalId, guruGantiId) => {
    try {
      const existing = kelasGanti.find(kg => kg.jadual_id === jadualId && kg.tarikh === selectedDate);
      if (existing) {
        if (!guruGantiId) {
          await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'kelas_ganti', existing.id));
        } else {
          await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'kelas_ganti', existing.id), { guru_ganti_id: guruGantiId });
        }
      } else if (guruGantiId) {
        await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'kelas_ganti'), {
          tarikh: selectedDate,
          jadual_id: jadualId,
          guru_asal_id: guruAsalId,
          guru_ganti_id: guruGantiId
        });
      }
    } catch (e) {
      console.error("Error saving relief", e);
    }
  };

  const getFreeTeachers = (slot) => {
    const slotStart = timeToMins(slot.masa_mula);
    const slotEnd = timeToMins(slot.masa_tamat);
    
    let free = teachers.filter(t => t.id !== slot.guru_id);
    
    // 1. Buang guru yang JUGA tidak hadir / ketiadaan pada waktu slot tersebut
    free = free.filter(t => {
      const tAbsences = ketiadaan.filter(k => k.guru_id === t.id && k.tarikh === selectedDate);
      const isAbsent = tAbsences.some(abs => {
        const absStart = timeToMins(abs.masa_mula);
        const absEnd = timeToMins(abs.masa_tamat);
        return !(slotEnd <= absStart || slotStart >= absEnd); 
      });
      return !isAbsent;
    });

    // 2. Buang guru yang ada kelas lain pada waktu slot tersebut
    free = free.filter(t => {
      const tSchedules = schedules.filter(s => s.guru_id === t.id && s.hari === selectedDayName);
      const isBusy = tSchedules.some(s => {
        const sStart = timeToMins(s.masa_mula);
        const sEnd = timeToMins(s.masa_tamat);
        return !(sEnd <= slotStart || sStart >= slotEnd); 
      });
      return !isBusy;
    });
    
    return free;
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
        <div className="mb-4 md:mb-0">
          <h3 className="text-lg font-bold text-gray-900">Pengurusan Guru Ganti (Relief)</h3>
          <p className="text-sm text-gray-500">Pilih guru lapang bagi menggantikan kelas guru yang tidak hadir.</p>
        </div>
        <div className="flex items-center bg-gray-50 p-2 rounded-lg border border-gray-200">
          <label className="mr-3 text-sm font-bold text-gray-700 flex items-center">
            <Calendar className="w-4 h-4 mr-1"/> Tarikh Relief:
          </label>
          <input 
            type="date" 
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border border-gray-300 rounded bg-white p-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-medium text-indigo-700"
          />
          <span className="ml-3 text-xs font-semibold bg-gray-200 text-gray-600 px-2 py-1 rounded">
            {selectedDayName}
          </span>
        </div>
      </div>

      {absentTeachersData.length === 0 ? (
        <div className="bg-green-50 p-8 text-center rounded-xl border border-green-200 shadow-sm">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-green-900">Semua Guru Berada Di Sekolah</h3>
          <p className="text-green-700 mt-1 text-sm">Tiada rekod ketiadaan spesifik atau ketidakhadiran dimasukkan untuk tarikh ini.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {absentTeachersData.map(teacher => {
            const tSlots = schedules.filter(s => s.guru_id === teacher.id && s.hari === selectedDayName).sort((a,b) => a.masa_mula.localeCompare(b.masa_mula));
            
            // TAPISAN BARU: Hanya tunjuk jadual kelas yang jatuh dalam "Masa Ketiadaan" guru tersebut
            const affectedSlots = tSlots.filter(slot => {
              const slotStart = timeToMins(slot.masa_mula);
              const slotEnd = timeToMins(slot.masa_tamat);
              return teacher.absences.some(abs => {
                const absStart = timeToMins(abs.masa_mula);
                const absEnd = timeToMins(abs.masa_tamat);
                return !(slotEnd <= absStart || slotStart >= absEnd); // Bertindih
              });
            });
            
            return (
              <div key={teacher.id} className="bg-white rounded-xl border border-red-200 overflow-hidden shadow-sm">
                <div className="bg-red-50 px-5 py-3 border-b border-red-100 flex justify-between items-center">
                  <div className="flex items-center">
                    <UserMinus className="w-5 h-5 text-red-500 mr-2" />
                    <h4 className="font-bold text-red-900">{teacher.nama}</h4>
                    <div className="ml-3 flex flex-wrap gap-1">
                      {teacher.absences.map(abs => (
                        <span key={abs.id} className="text-[10px] font-semibold bg-red-200 text-red-800 px-2 py-0.5 rounded-full border border-red-300">
                          {abs.masa_mula}-{abs.masa_tamat} ({abs.sebab})
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="text-sm font-bold text-red-700 bg-red-100 px-3 py-1 rounded-lg border border-red-200">
                    {affectedSlots.length} Kelas Terjejas
                  </span>
                </div>
                
                {affectedSlots.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-white">
                        <tr>
                          <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Masa</th>
                          <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Kelas & Subjek</th>
                          <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-indigo-50/30">Tindakan Guru Ganti</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {affectedSlots.map(slot => {
                          const freeTeachers = getFreeTeachers(slot);
                          const currentRelief = kelasGanti.find(kg => kg.jadual_id === slot.id && kg.tarikh === selectedDate);
                          
                          return (
                            <tr key={slot.id} className={currentRelief ? 'bg-indigo-50/50' : 'hover:bg-gray-50'}>
                              <td className="px-5 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                                {slot.masa_mula} - {slot.masa_tamat}
                              </td>
                              <td className="px-5 py-4">
                                <p className="text-sm font-bold text-gray-900 mb-0.5">{slot.kelas}</p>
                                <p className="text-xs font-medium text-gray-500">{slot.subjek} • <span className="text-gray-400">{slot.lokasi}</span></p>
                              </td>
                              <td className="px-5 py-4 w-96">
                                <select 
                                  className={`w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow ${currentRelief ? 'border-indigo-400 bg-white font-bold text-indigo-700 shadow-sm' : 'border-gray-300 bg-gray-50 hover:bg-white text-gray-700'}`}
                                  value={currentRelief ? currentRelief.guru_ganti_id : ''}
                                  onChange={(e) => saveRelief(slot.id, teacher.id, e.target.value)}
                                >
                                  <option value="">-- Tugaskan Guru --</option>
                                  {freeTeachers.length > 0 ? (
                                    <optgroup label="✅ Cadangan Guru Lapang">
                                      {freeTeachers.map(ft => (
                                        <option key={ft.id} value={ft.id}>{ft.nama} ({ft.subjek})</option>
                                      ))}
                                    </optgroup>
                                  ) : (
                                    <optgroup label="❌ Tiada Guru Lapang Secara Automatik"></optgroup>
                                  )}
                                  
                                  <optgroup label="⚠️ Guru Lain (Sedang Mengajar / Bertindih / Tiada)">
                                    {teachers.filter(t => t.id !== slot.guru_id && !freeTeachers.find(ft => ft.id === t.id)).map(bt => (
                                      <option key={bt.id} value={bt.id}>{bt.nama} (Tidak Tersedia)</option>
                                    ))}
                                  </optgroup>
                                </select>
                                {currentRelief && (
                                  <p className="text-xs text-indigo-600 mt-2 font-medium flex items-center">
                                    <CheckCircle className="w-3.5 h-3.5 mr-1" /> Telah ditugaskan
                                  </p>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-center text-sm text-gray-500 font-medium">
                    Tiada kelas yang dijadualkan semasa waktu ketiadaan {teacher.nama} pada hari ini.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- SCHEDULE MANAGER COMPONENT (SUB-ADMIN) ---
function ScheduleManager({ teacher, schedules, onBack, db, appId, user }) {
  const [editingSlot, setEditingSlot] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [feedback, setFeedback] = useState({ type: '', msg: '' });
  
  const [formData, setFormData] = useState({
    hari: 'Isnin', masa_mula: '', masa_tamat: '', kelas: '', subjek: teacher.subjek || '', lokasi: ''
  });

  const dayOrder = { 'Isnin': 1, 'Selasa': 2, 'Rabu': 3, 'Khamis': 4, 'Jumaat': 5, 'Sabtu': 6, 'Ahad': 7 };
  
  const teacherSchedules = schedules
    .filter(s => s.guru_id === teacher.id)
    .sort((a, b) => {
      if (dayOrder[a.hari] !== dayOrder[b.hari]) return (dayOrder[a.hari] || 8) - (dayOrder[b.hari] || 8);
      return a.masa_mula.localeCompare(b.masa_mula);
    });

  const showFeedback = (type, msg) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback({ type: '', msg: '' }), 4000);
  };

  const resetForm = () => {
    setEditingSlot(null);
    setFormData({ hari: 'Isnin', masa_mula: '', masa_tamat: '', kelas: '', subjek: teacher.subjek || '', lokasi: '' });
  };

  const handleEditClick = (slot) => {
    setEditingSlot(slot);
    setFormData({
      hari: slot.hari, masa_mula: slot.masa_mula, masa_tamat: slot.masa_tamat,
      kelas: slot.kelas, subjek: slot.subjek, lokasi: slot.lokasi || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editingSlot) {
        const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'jadual', editingSlot.id);
        await updateDoc(docRef, formData);
        showFeedback('success', 'Slot jadual berjaya dikemaskini.');
      } else {
        const collRef = collection(db, 'artifacts', appId, 'users', user.uid, 'jadual');
        await addDoc(collRef, { ...formData, guru_id: teacher.id });
        showFeedback('success', 'Slot jadual baru berjaya ditambah.');
      }
      resetForm();
    } catch (err) {
      console.error(err);
      showFeedback('error', 'Gagal menyimpan maklumat jadual.');
    }
  };

  const confirmDelete = async (id) => {
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'jadual', id));
      showFeedback('success', 'Slot jadual berjaya dipadam.');
    } catch (err) {
      console.error(err);
      showFeedback('error', 'Gagal memadam jadual.');
    } finally {
      setDeleteConfirmId(null);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 min-h-[600px] flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 bg-gray-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center">
          <button 
            onClick={onBack}
            className="mr-4 p-2 bg-white rounded-lg border border-gray-200 text-gray-500 hover:text-indigo-600 hover:border-indigo-200 transition shadow-sm"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Urus Jadual Mingguan</h2>
            <p className="text-sm text-gray-500 font-medium">Guru: <span className="text-indigo-600">{teacher.nama}</span></p>
          </div>
        </div>
      </div>

      <div className="p-6 flex-1 bg-gray-50/50">
        
        {/* Feedback Alert */}
        {feedback.msg && (
          <div className={`mb-6 p-4 rounded-xl flex items-center border ${feedback.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            {feedback.type === 'success' ? <CheckCircle className="w-5 h-5 mr-2" /> : <AlertCircle className="w-5 h-5 mr-2" />}
            {feedback.msg}
          </div>
        )}

        {/* Borang Tambah/Edit */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mb-8">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
            {editingSlot ? <Edit className="w-5 h-5 mr-2 text-indigo-500" /> : <Plus className="w-5 h-5 mr-2 text-green-500" />}
            {editingSlot ? 'Kemaskini Slot Jadual' : 'Tambah Slot Baru'}
          </h3>
          
          <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hari</label>
              <select required className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                value={formData.hari} onChange={(e) => setFormData({...formData, hari: e.target.value})}
              >
                {['Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu', 'Ahad'].map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Masa Mula</label>
              <input type="time" required className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                value={formData.masa_mula} onChange={(e) => setFormData({...formData, masa_mula: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Masa Tamat</label>
              <input type="time" required className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                value={formData.masa_tamat} onChange={(e) => setFormData({...formData, masa_tamat: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Kelas</label>
              <input type="text" placeholder="Cth: 5 Amanah" required className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                value={formData.kelas} onChange={(e) => setFormData({...formData, kelas: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subjek</label>
              <input type="text" placeholder="Cth: Matematik" required className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                value={formData.subjek} onChange={(e) => setFormData({...formData, subjek: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lokasi</label>
              <input type="text" placeholder="Cth: Makmal 1" required className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                value={formData.lokasi} onChange={(e) => setFormData({...formData, lokasi: e.target.value})}
              />
            </div>
            
            <div className="md:col-span-3 flex justify-end space-x-3 mt-2">
              {editingSlot && (
                <button type="button" onClick={resetForm} className="px-5 py-2.5 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition">
                  Batal Edit
                </button>
              )}
              <button type="submit" className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm transition">
                {editingSlot ? 'Simpan Perubahan' : 'Tambah Jadual'}
              </button>
            </div>
          </form>
        </div>

        {/* Senarai Jadual Mingguan */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <h3 className="text-lg font-bold text-gray-900 flex items-center">
              <Calendar className="w-5 h-5 mr-2 text-indigo-500" /> Senarai Jadual Semasa
            </h3>
          </div>
          
          {teacherSchedules.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">Hari & Masa</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">Maklumat Kelas</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">Lokasi</th>
                    <th className="px-6 py-3 text-right font-semibold text-gray-600 uppercase tracking-wider">Tindakan</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {teacherSchedules.map((slot) => (
                    <tr key={slot.id} className={editingSlot?.id === slot.id ? 'bg-indigo-50' : 'hover:bg-gray-50'}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-bold text-gray-900">{slot.hari}</div>
                        <div className="text-gray-500 flex items-center mt-1">
                          <Clock className="w-3.5 h-3.5 mr-1" /> {slot.masa_mula} - {slot.masa_tamat}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{slot.kelas}</div>
                        <div className="text-gray-500">{slot.subjek}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="inline-flex items-center px-2.5 py-1 rounded-md bg-gray-100 text-gray-700 border border-gray-200">
                          <MapPin className="w-3.5 h-3.5 mr-1 text-indigo-500" /> {slot.lokasi}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        {deleteConfirmId === slot.id ? (
                          <div className="flex items-center justify-end space-x-2">
                            <span className="text-xs font-bold text-red-600 mr-2">Pasti padam?</span>
                            <button onClick={() => confirmDelete(slot.id)} className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition">Ya</button>
                            <button onClick={() => setDeleteConfirmId(null)} className="px-3 py-1 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition">Batal</button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end space-x-3">
                            <button onClick={() => handleEditClick(slot)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Edit">
                              <Edit className="w-4.5 h-4.5" />
                            </button>
                            <button onClick={() => setDeleteConfirmId(slot.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition" title="Padam">
                              <Trash2 className="w-4.5 h-4.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-lg">Tiada jadual direkodkan untuk guru ini.</p>
              <p className="text-sm text-gray-400 mt-1">Sila tambah menggunakan borang di atas atau muat naik PDF.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- ABSENCE MANAGER COMPONENT (SUB-ADMIN) ---
function AbsenceManager({ teacher, ketiadaan, onBack, db, appId, user }) {
  const [formData, setFormData] = useState({
    tarikh: getTodayDateString(),
    masa_mula: '07:30',
    masa_tamat: '14:30',
    sebab: 'Tidak Hadir',
    lokasi: ''
  });
  const [feedback, setFeedback] = useState({ type: '', msg: '' });

  // Susun rekod terbaru di atas
  const teacherAbsences = ketiadaan
    .filter(k => k.guru_id === teacher.id)
    .sort((a, b) => new Date(b.tarikh) - new Date(a.tarikh) || b.masa_mula.localeCompare(a.masa_mula));

  const showFeedback = (type, msg) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback({ type: '', msg: '' }), 4000);
  };

  const setPreset = (type) => {
    if (type === 'sepenuh_hari') setFormData({ ...formData, masa_mula: '07:30', masa_tamat: '14:30' });
    if (type === 'sesi_pagi') setFormData({ ...formData, masa_mula: '07:30', masa_tamat: '10:30' });
    if (type === 'sesi_tengahari') setFormData({ ...formData, masa_mula: '10:30', masa_tamat: '14:30' });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'ketiadaan'), {
        ...formData,
        guru_id: teacher.id
      });
      showFeedback('success', 'Rekod ketiadaan berjaya ditambah.');
      setFormData({ ...formData, lokasi: '' }); // reset only location for next entry
    } catch (err) {
      console.error(err);
      showFeedback('error', 'Gagal menyimpan rekod ketiadaan.');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'ketiadaan', id));
      showFeedback('success', 'Rekod berjaya dipadam.');
    } catch (err) {
      console.error(err);
      showFeedback('error', 'Gagal memadam rekod.');
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 min-h-[600px] flex flex-col">
      <div className="border-b border-gray-200 bg-gray-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center">
          <button 
            onClick={onBack}
            className="mr-4 p-2 bg-white rounded-lg border border-gray-200 text-gray-500 hover:text-orange-600 hover:border-orange-200 transition shadow-sm"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Urus Ketiadaan (Masa Spesifik)</h2>
            <p className="text-sm text-gray-500 font-medium">Guru: <span className="text-orange-600">{teacher.nama}</span></p>
          </div>
        </div>
      </div>

      <div className="p-6 flex-1 bg-gray-50/50">
        {feedback.msg && (
          <div className={`mb-6 p-4 rounded-xl flex items-center border ${feedback.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            {feedback.type === 'success' ? <CheckCircle className="w-5 h-5 mr-2" /> : <AlertCircle className="w-5 h-5 mr-2" />}
            {feedback.msg}
          </div>
        )}

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mb-8">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4">
            <h3 className="text-lg font-bold text-gray-900 flex items-center">
              <Plus className="w-5 h-5 mr-2 text-green-500" /> Tambah Rekod Baru
            </h3>
            <div className="flex space-x-2 mt-3 sm:mt-0">
              <button onClick={() => setPreset('sepenuh_hari')} type="button" className="text-xs font-bold px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition">Sepenuh Hari</button>
              <button onClick={() => setPreset('sesi_pagi')} type="button" className="text-xs font-bold px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition">Sesi Pagi</button>
              <button onClick={() => setPreset('sesi_tengahari')} type="button" className="text-xs font-bold px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition">Tengah Hari</button>
            </div>
          </div>
          
          <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tarikh</label>
              <input type="date" required className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                value={formData.tarikh} onChange={(e) => setFormData({...formData, tarikh: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dari Jam</label>
              <input type="time" required className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                value={formData.masa_mula} onChange={(e) => setFormData({...formData, masa_mula: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hingga Jam</label>
              <input type="time" required className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                value={formData.masa_tamat} onChange={(e) => setFormData({...formData, masa_tamat: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status/Sebab</label>
              <select required className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                value={formData.sebab} onChange={(e) => setFormData({...formData, sebab: e.target.value})}
              >
                <option value="Tidak Hadir">Tidak Hadir (Umum)</option>
                <option value="Mesyuarat">Mesyuarat / Taklimat</option>
                <option value="Cuti Rehat">Cuti Rehat / Cuti Sakit</option>
                <option value="Tugas Luar">Tugas Rasmi Luar</option>
                <option value="Kecemasan">Kecemasan</option>
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Lokasi / Catatan (Pilihan)</label>
              <input type="text" placeholder="Cth: PPD Kinta Utara / Klinik Kesihatan" className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                value={formData.lokasi} onChange={(e) => setFormData({...formData, lokasi: e.target.value})}
              />
            </div>
            <div className="md:col-span-1 flex items-end">
              <button type="submit" className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium shadow-sm transition">
                Simpan
              </button>
            </div>
          </form>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <h3 className="text-lg font-bold text-gray-900 flex items-center">
              <Clock className="w-5 h-5 mr-2 text-orange-500" /> Senarai Rekod Ketiadaan
            </h3>
          </div>
          
          {teacherAbsences.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">Tarikh</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">Masa</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">Status & Catatan</th>
                    <th className="px-6 py-3 text-right font-semibold text-gray-600 uppercase tracking-wider">Padam</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {teacherAbsences.map((abs) => (
                    <tr key={abs.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap font-bold text-gray-900">
                        {abs.tarikh}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="bg-orange-100 text-orange-800 font-bold px-2.5 py-1 rounded-md text-xs">
                          {abs.masa_mula} - {abs.masa_tamat}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-bold text-gray-900">{abs.sebab}</div>
                        {abs.lokasi && <div className="text-gray-500 mt-0.5 text-xs flex items-center"><MapPin className="w-3 h-3 mr-1" /> {abs.lokasi}</div>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button onClick={() => handleDelete(abs.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition" title="Padam">
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-10 text-gray-500">
              Tiada rekod ketiadaan dimasukkan untuk guru ini.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
