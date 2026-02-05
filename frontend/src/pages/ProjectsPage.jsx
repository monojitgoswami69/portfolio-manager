import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Folder, Plus, ExternalLink, Github, Save, Trash2, Pencil, X, RefreshCw } from 'lucide-react';
import { cn } from '../utils/helpers';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import { cachedApiCall, clearCached } from '../utils/sessionCache';

// --- Full Screen Modal Component with createPortal ---
const FullScreenModal = ({ isOpen, onClose, title, children, footer }) => {
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return createPortal(
        <div
            className="fixed inset-0 flex items-center justify-center p-4"
            style={{
                zIndex: 99999,
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100vw',
                height: '100vh'
            }}
        >
            {/* Backdrop - covers EVERYTHING including sidebar */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0
                }}
            />

            {/* Modal Content */}
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="relative bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 flex-shrink-0">
                    <h2 className="text-xl font-bold text-neutral-900">{title}</h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-neutral-100 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body - scrollable */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-neutral-200 bg-neutral-50 flex-shrink-0">
                        {footer}
                    </div>
                )}
            </motion.div>
        </div>,
        document.body
    );
};

// --- Project Form Component (used by both Add and Edit modals) ---
const ProjectForm = ({ formData, setFormData }) => {
    return (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Project Name *</label>
                <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                    placeholder="My Awesome Project"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Short Description *</label>
                <input
                    type="text"
                    required
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                    placeholder="A brief one-liner about the project"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Long Description</label>
                <textarea
                    value={formData.longDescription}
                    onChange={(e) => setFormData({ ...formData, longDescription: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm font-mono"
                    placeholder="Detailed description of the project..."
                />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">Status</label>
                    <select
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                        className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                    >
                        <option value="In Progress">In Progress</option>
                        <option value="Completed">Completed</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">Category</label>
                    <input
                        type="text"
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                        placeholder="Web App, Mobile, etc."
                    />
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Tech Stack (comma-separated)</label>
                <input
                    type="text"
                    value={formData.techStack}
                    onChange={(e) => setFormData({ ...formData, techStack: e.target.value })}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                    placeholder="React, Node.js, MongoDB"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Features (one per line)</label>
                <textarea
                    value={formData.features}
                    onChange={(e) => setFormData({ ...formData, features: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm font-mono"
                    placeholder={"Feature 1\nFeature 2\nFeature 3"}
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Project Image</label>
                <div className="space-y-2">
                    <div className="flex gap-2">
                        <label className="flex-1">
                            <div className="px-3 py-2 border-2 border-dashed border-neutral-300 rounded-lg hover:border-primary-500 cursor-pointer text-center text-sm text-neutral-600 hover:text-primary-600 transition-colors">
                                {formData.imageFile ? formData.imageFile.name : 'Choose image file'}
                            </div>
                            <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                        if (file.size > 2 * 1024 * 1024) {
                                            alert('File size exceeds 2MB limit');
                                            e.target.value = '';
                                            return;
                                        }
                                        const reader = new FileReader();
                                        reader.onload = (e) => {
                                            setFormData({
                                                ...formData,
                                                imageFile: file,
                                                imagePreview: e.target.result
                                            });
                                        };
                                        reader.readAsDataURL(file);
                                    }
                                }}
                                className="hidden"
                            />
                        </label>
                    </div>

                    {/* Preview */}
                    {(formData.imagePreview || (formData.imageUrl && !formData.imageUrl.startsWith('public/projects/'))) && (
                        <div className="relative w-full h-32 rounded-lg overflow-hidden border border-neutral-200">
                            <img
                                src={formData.imagePreview || formData.imageUrl}
                                alt="Preview"
                                className="w-full h-full object-cover"
                            />
                            {formData.imageFile && (
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, imageFile: null, imagePreview: null })}
                                    className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded hover:bg-red-600"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    )}

                    {/* URL fallback */}
                    <div className="text-xs text-neutral-500 mt-2">Or paste image URL as fallback:</div>
                    <input
                        type="url"
                        value={formData.imageUrl || ''}
                        onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                        disabled={!!formData.imageFile}
                        className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        placeholder="https://example.com/image.jpg"
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">GitHub URL</label>
                    <input
                        type="url"
                        value={formData.githubUrl}
                        onChange={(e) => setFormData({ ...formData, githubUrl: e.target.value })}
                        className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                        placeholder="https://github.com/..."
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">Demo URL</label>
                    <input
                        type="url"
                        value={formData.demoUrl}
                        onChange={(e) => setFormData({ ...formData, demoUrl: e.target.value })}
                        className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                        placeholder="https://demo.example.com"
                    />
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Challenges</label>
                <textarea
                    value={formData.challenges}
                    onChange={(e) => setFormData({ ...formData, challenges: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                    placeholder="What challenges did you face?"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Key Learnings</label>
                <textarea
                    value={formData.learnings}
                    onChange={(e) => setFormData({ ...formData, learnings: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                    placeholder="What did you learn from this project?"
                />
            </div>

            <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    id="featured-checkbox"
                    checked={formData.featured}
                    onChange={(e) => setFormData({ ...formData, featured: e.target.checked })}
                    className="w-4 h-4 text-primary-600 border-neutral-300 rounded focus:ring-primary-500"
                />
                <label htmlFor="featured-checkbox" className="text-sm font-medium text-neutral-700">
                    Mark as Featured
                </label>
            </div>
        </div>
    );
};

// --- Expandable Project Card ---
const ProjectCard = ({ project, onEdit, onDelete }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="border border-neutral-200 rounded-xl overflow-hidden bg-white shadow-sm flex flex-col transition-all duration-300">
            <div
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 bg-white hover:bg-neutral-50 transition-colors cursor-pointer select-none"
                aria-expanded={isOpen}
            >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`p-2 rounded-lg flex-shrink-0 ${isOpen ? 'bg-primary-50 text-primary-600' : 'bg-neutral-100 text-neutral-600'}`}>
                        <Folder className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-semibold text-neutral-900 truncate">{project.name}</h3>
                        <p className="text-sm text-neutral-500 truncate">{project.description}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={cn(
                        "px-2 py-0.5 text-xs rounded-full font-medium",
                        project.status === 'Completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                    )}>
                        {project.status}
                    </span>
                    {project.featured && (
                        <span className="px-2 py-0.5 text-xs rounded-full font-medium bg-amber-100 text-amber-700">
                            Featured
                        </span>
                    )}
                    {isOpen ? (
                        <ChevronDown className="w-5 h-5 text-neutral-400" />
                    ) : (
                        <ChevronRight className="w-5 h-5 text-neutral-400" />
                    )}
                </div>
            </div>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="border-t border-neutral-100 bg-neutral-50"
                    >
                        <div className="p-6 space-y-4">
                            {/* Image */}
                            {project.imageUrl && (
                                <div className="rounded-lg overflow-hidden border border-neutral-200">
                                    <img src={project.imageUrl} alt={project.name} className="w-full h-48 object-cover" />
                                </div>
                            )}

                            {/* Long Description */}
                            <div>
                                <h4 className="text-sm font-semibold text-neutral-700 mb-2">Description</h4>
                                <p className="text-sm text-neutral-600 whitespace-pre-line">{project.longDescription}</p>
                            </div>

                            {/* Tech Stack */}
                            <div>
                                <h4 className="text-sm font-semibold text-neutral-700 mb-2">Tech Stack</h4>
                                <div className="flex flex-wrap gap-2">
                                    {project.techStack.map((tech, idx) => (
                                        <span key={idx} className="px-2 py-1 bg-neutral-100 text-neutral-700 text-xs rounded">
                                            {tech}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Features */}
                            {project.features && project.features.length > 0 && (
                                <div>
                                    <h4 className="text-sm font-semibold text-neutral-700 mb-2">Features</h4>
                                    <ul className="list-disc list-inside text-sm text-neutral-600 space-y-1">
                                        {project.features.map((feature, idx) => (
                                            <li key={idx}>{feature}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Challenges */}
                            {project.challenges && (
                                <div>
                                    <h4 className="text-sm font-semibold text-neutral-700 mb-2">Challenges</h4>
                                    <p className="text-sm text-neutral-600">{project.challenges}</p>
                                </div>
                            )}

                            {/* Learnings */}
                            {project.learnings && (
                                <div>
                                    <h4 className="text-sm font-semibold text-neutral-700 mb-2">Key Learnings</h4>
                                    <p className="text-sm text-neutral-600">{project.learnings}</p>
                                </div>
                            )}

                            {/* Links & Actions */}
                            <div className="flex items-center justify-between pt-4 border-t border-neutral-200">
                                <div className="flex gap-2">
                                    {project.githubUrl && project.githubUrl !== '' && project.githubUrl !== '#' && (
                                        <a
                                            href={project.githubUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 text-white rounded-lg text-xs font-medium hover:bg-neutral-700 transition-colors"
                                        >
                                            <Github className="w-3.5 h-3.5" />
                                            <span>GitHub</span>
                                        </a>
                                    )}
                                    {project.demoUrl && project.demoUrl !== '' && project.demoUrl !== '#' && (
                                        <a
                                            href={project.demoUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-medium hover:bg-primary-700 transition-colors"
                                        >
                                            <ExternalLink className="w-3.5 h-3.5" />
                                            <span>Live Demo</span>
                                        </a>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onEdit(project);
                                        }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors"
                                    >
                                        <Pencil className="w-3.5 h-3.5" />
                                        <span>Edit</span>
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDelete(project);
                                        }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span>Delete</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// --- Helper to convert project to form data ---
const projectToFormData = (project) => ({
    name: project.name || '',
    description: project.description || '',
    longDescription: project.longDescription || '',
    techStack: Array.isArray(project.techStack) ? project.techStack.join(', ') : '',
    // Don't display "public/projects/" URLs as they're server-generated
    imageUrl: (project.imageUrl && !project.imageUrl.startsWith('public/projects/')) ? project.imageUrl : '',
    imageFile: null,
    imagePreview: null,
    githubUrl: project.githubUrl || '',
    demoUrl: project.demoUrl || '',
    status: project.status || 'In Progress',
    features: Array.isArray(project.features) ? project.features.join('\n') : '',
    challenges: project.challenges || '',
    learnings: project.learnings || '',
    category: project.category || '',
    featured: project.featured || false
});

// --- Helper to convert form data to project ---
const formDataToProject = (formData) => {
    const { imageFile, imagePreview, ...projectData } = formData;
    return {
        ...projectData,
        techStack: projectData.techStack.split(',').map(t => t.trim()).filter(Boolean),
        features: projectData.features.split('\n').map(f => f.trim()).filter(Boolean),
        screenshots: []
    };
};

// --- Initial empty form state ---
const EMPTY_FORM = {
    name: '',
    description: '',
    longDescription: '',
    techStack: '',
    imageUrl: '',
    imageFile: null,
    imagePreview: null,
    githubUrl: '',
    demoUrl: '',
    status: 'In Progress',
    features: '',
    challenges: '',
    learnings: '',
    category: '',
    featured: false
};

// --- Main Projects Page ---
export default function ProjectsPage() {
    const [projects, setProjects] = useState([]);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingProject, setEditingProject] = useState(null);
    const [addFormData, setAddFormData] = useState(EMPTY_FORM);
    const [editFormData, setEditFormData] = useState(EMPTY_FORM);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const { addToast } = useToast();

    useEffect(() => {
        loadProjects();
    }, []);

    const loadProjects = async (forceRefresh = false) => {
        try {
            setLoading(true);
            if (forceRefresh) {
                clearCached('projects_all');
            }
            
            const response = await cachedApiCall('projects_all', () => api.projects.get(), forceRefresh);
            setProjects(response.projects || []);
        } catch (error) {
            addToast({
                action: "Error",
                fileName: "Projects",
                status: 'error',
                message: error.message || "Failed to load projects",
            });
        } finally {
            setLoading(false);
        }
    };

    const saveProjectsToBackend = async (updatedProjects) => {
        try {
            setSaving(true);
            await api.projects.save(updatedProjects);
            clearCached('projects_all'); // Clear cache after save
        } catch (error) {
            addToast({
                action: "Error",
                fileName: "Projects",
                status: 'error',
                message: error.message || "Failed to save projects",
            });
            throw error;
        } finally {
            setSaving(false);
        }
    };

    const uploadProjectImage = async (formData, projectName) => {
        if (!formData.imageFile) {
            return formData.imageUrl; // Return existing URL if no new file
        }

        try {
            const response = await api.projects.uploadImage(formData.imageFile, projectName);
            return response.imageUrl; // Return auto-generated URL from backend
        } catch (error) {
            addToast({
                action: "Error",
                fileName: "Image Upload",
                status: 'error',
                message: error.message || "Failed to upload project image",
            });
            throw error;
        }
    };

    const handleAddProject = async () => {
        if (!addFormData.name.trim()) return;

        try {
            setSaving(true);
            // Upload image if file is selected
            const imageUrl = await uploadProjectImage(addFormData, addFormData.name);

            // Create project with uploaded image URL
            const projectFormData = { ...addFormData, imageUrl };
            const newProject = formDataToProject(projectFormData);
            const updatedProjects = [newProject, ...projects];

            await saveProjectsToBackend(updatedProjects);
            setProjects(updatedProjects);
            setIsAddModalOpen(false);
            setAddFormData(EMPTY_FORM);

            addToast({
                action: "Added",
                fileName: newProject.name,
                status: 'complete',
                message: "Project added successfully",
            });
        } catch (error) {
            // Error toast already shown in uploadProjectImage or saveProjectsToBackend
        } finally {
            setSaving(false);
        }
    };

    const handleEditProject = (project) => {
        setEditingProject(project);
        setEditFormData(projectToFormData(project));
    };

    const handleSaveEdit = async () => {
        if (!editFormData.name.trim()) return;

        try {
            setSaving(true);
            // Upload image if file is selected
            const imageUrl = await uploadProjectImage(editFormData, editFormData.name);

            // Create project with uploaded image URL
            const projectFormData = { ...editFormData, imageUrl };
            const updatedProject = formDataToProject(projectFormData);
            const updatedProjects = projects.map(p =>
                p.name === editingProject.name ? updatedProject : p
            );

            await saveProjectsToBackend(updatedProjects);
            setProjects(updatedProjects);
            setEditingProject(null);
            setEditFormData(EMPTY_FORM);

            addToast({
                action: "Updated",
                fileName: updatedProject.name,
                status: 'complete',
                message: "Project updated successfully",
            });
        } catch (error) {
            // Error toast already shown in uploadProjectImage or saveProjectsToBackend
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteProject = async (projectToDelete) => {
        const updatedProjects = projects.filter(p => p.name !== projectToDelete.name);
        
        try {
            await saveProjectsToBackend(updatedProjects);
            setProjects(updatedProjects);
            addToast({
                action: "Deleted",
                fileName: projectToDelete.name,
                status: 'complete',
                message: "Project deleted successfully",
            });
        } catch (error) {
            // Error toast already shown in saveProjectsToBackend
        }
    };

    return (
        <div className="w-full h-full flex flex-col py-4 px-2 sm:px-6 overflow-y-auto">
            <div className="mb-6 flex-shrink-0 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-neutral-900 mb-2">Projects</h1>
                    <p className="text-neutral-500">
                        Manage your project portfolio. {projects.length} project{projects.length !== 1 ? 's' : ''} total.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => loadProjects(true)}
                        disabled={loading || saving}
                        className="p-2 text-neutral-600 hover:text-neutral-900 transition-colors disabled:opacity-50"
                        title="Refresh"
                    >
                        <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        disabled={loading || saving}
                        className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors shadow-sm font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Plus className="w-4 h-4" />
                        Add Project
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center h-full min-h-[400px]">
                    <div className="flex flex-col items-center gap-4">
                        <div className="flex gap-2">
                            {[0, 1, 2].map((i) => (
                                <div
                                    key={i}
                                    className="w-3 h-3 bg-primary-600 rounded-full animate-bounce"
                                    style={{ animationDelay: `${i * 0.15}s` }}
                                />
                            ))}
                        </div>
                        <span className="text-neutral-600 font-medium">Loading projects...</span>
                    </div>
                </div>
            ) : (
                <div className="flex-1 space-y-2 pb-10">
                    {projects.map((project, idx) => (
                        <ProjectCard
                            key={project.name + idx}
                            project={project}
                            onEdit={handleEditProject}
                            onDelete={handleDeleteProject}
                        />
                    ))}

                    {projects.length === 0 && (
                        <div className="text-center py-12 text-neutral-400">
                            <Folder className="w-12 h-12 mx-auto mb-3 opacity-50" />
                            <p>No projects yet. Click "Add Project" to get started.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Add Project Modal */}
            <FullScreenModal
                isOpen={isAddModalOpen}
                onClose={() => {
                    setIsAddModalOpen(false);
                    setAddFormData(EMPTY_FORM);
                }}
                title="Add New Project"
                footer={
                    <>
                        <button
                            onClick={() => {
                                setIsAddModalOpen(false);
                                setAddFormData(EMPTY_FORM);
                            }}
                            className="px-4 py-2 text-sm font-medium text-neutral-700 bg-white border border-neutral-300 rounded-lg hover:bg-neutral-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleAddProject}
                            disabled={!addFormData.name.trim() || saving}
                            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {saving ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            ) : (
                                <Save className="w-4 h-4" />
                            )}
                            {saving ? 'Saving...' : 'Add Project'}
                        </button>
                    </>
                }
            >
                <ProjectForm formData={addFormData} setFormData={setAddFormData} />
            </FullScreenModal>

            {/* Edit Project Modal */}
            <FullScreenModal
                isOpen={!!editingProject}
                onClose={() => {
                    setEditingProject(null);
                    setEditFormData(EMPTY_FORM);
                }}
                title={`Edit Project: ${editingProject?.name || ''}`}
                footer={
                    <>
                        <button
                            onClick={() => {
                                setEditingProject(null);
                                setEditFormData(EMPTY_FORM);
                            }}
                            className="px-4 py-2 text-sm font-medium text-neutral-700 bg-white border border-neutral-300 rounded-lg hover:bg-neutral-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSaveEdit}
                            disabled={!editFormData.name.trim() || saving}
                            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {saving ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            ) : (
                                <Save className="w-4 h-4" />
                            )}
                            {saving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </>
                }
            >
                <ProjectForm formData={editFormData} setFormData={setEditFormData} />
            </FullScreenModal>
        </div>
    );
}
