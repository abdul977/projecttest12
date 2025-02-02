import { useState, useEffect, FC } from "react";
import { CreateNoteButton } from "@/components/CreateNoteButton";
import { EmptyState } from "@/components/EmptyState";
import { NoteCard } from "@/components/NoteCard";
import { NoteEditor } from "@/components/NoteEditor";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  NotebookPen,
  Sparkles,
  Lightbulb,
  Rocket,
  Loader2,
  PlusCircle,
  Copy
} from "lucide-react";
import { ProcessingVariant, Note, NoteEntry } from "@/types/note";
import { useAuth } from "@/hooks/use-auth";

const Index: React.FC = () => {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | undefined>(undefined);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: notes = [], isLoading, error } = useQuery({
    queryKey: ['notes', user?.id],
    queryFn: async () => {
      if (!user?.id) {
        console.warn('No user ID available');
        return [];
      }

      console.log('Fetching notes for user:', user.id);
      // First fetch the notes we have access to
      const { data: notesData, error: notesError } = await supabase
        .from('notes')
        .select('id, title, created_at, collaborators, user_id')
        .or('user_id.eq.' + user.id + ',collaborators.cs.{user_id:"' + user.id + '"}')
        .order('created_at', { ascending: false });

      if (notesError) {
        console.error('Error fetching notes:', notesError);
        throw notesError;
      }
      
      if (!notesData?.length) {
        console.warn('No notes data returned');
        return [];
      }

      console.log('Successfully fetched notes:', notesData.length);

      // Then fetch entries for these notes
      const noteIds = notesData.map(note => note.id);
      const { data: entriesData, error: entriesError } = await supabase
        .from('note_entries')
        .select('id, content, audio_url, entry_order, created_at, note_id')
        .in('note_id', noteIds)
        .order('entry_order', { ascending: true });

      if (entriesError) {
        console.error('Error fetching note entries:', entriesError);
        throw entriesError;
      }

      // Organize entries by note ID
      const entriesByNoteId = (entriesData || []).reduce((acc: { [key: string]: any[] }, entry) => {
        if (!acc[entry.note_id]) {
          acc[entry.note_id] = [];
        }
        acc[entry.note_id].push(entry);
        return acc;
      }, {});

      // Transform the data into the expected Note format
      return notesData.map((note) => ({
        ...note,
        entries: (entriesByNoteId[note.id] || [])
          .sort((a: NoteEntry, b: NoteEntry) => (a.entry_order ?? 0) - (b.entry_order ?? 0)),
        content_versions: [],
        processingType: ProcessingVariant.SUMMARY,
        collaborators: (note.collaborators || []).map((collab: any) => ({
          user_id: collab.user_id,
          permission: collab.permission || 'view',
          joined_at: collab.joined_at || note.created_at,
          last_active: collab.last_active
        }))
      }));
    },
    enabled: !!user,
  });

  const createNoteMutation = useMutation({
    mutationFn: async (noteData: { 
      title: string, 
      entries: { content: string; audio_url?: string }[], 
      processingType: ProcessingVariant 
    }) => {
      const { data: note, error: noteError } = await supabase
        .from('notes')
        .insert([{ 
          title: noteData.title,
          user_id: user?.id,
          collaborators: []
        }])
        .select()
        .single();

      if (noteError) throw noteError;

      const entries = noteData.entries.map((entry, index) => ({
        note_id: note.id,
        content: entry.content,
        audio_url: entry.audio_url,
        entry_order: index,
      }));

      const { error: entriesError } = await supabase
        .from('note_entries')
        .insert(entries);

      if (entriesError) throw entriesError;

      return note;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', user?.id] });
      toast({
        title: "Note created",
        description: "Your note has been created successfully.",
      });
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async (noteData: { 
      id: string; 
      title: string; 
      entries: { id?: string; content: string; audio_url?: string }[];
      processingType: ProcessingVariant 
    }) => {
      const { error: noteError } = await supabase
        .from('notes')
        .update({ title: noteData.title })
        .eq('id', noteData.id);

      if (noteError) throw noteError;

      const { error: deleteError } = await supabase
        .from('note_entries')
        .delete()
        .eq('note_id', noteData.id);

      if (deleteError) throw deleteError;

      const entries = noteData.entries.map((entry, index) => ({
        note_id: noteData.id,
        content: entry.content,
        audio_url: entry.audio_url,
        entry_order: index,
      }));

      const { error: entriesError } = await supabase
        .from('note_entries')
        .insert(entries);

      if (entriesError) throw entriesError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', user?.id] });
      toast({
        title: "Note updated",
        description: "Your note has been updated successfully.",
      });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notes')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', user?.id] });
      toast({
        title: "Note deleted",
        description: "Your note has been deleted successfully.",
        variant: "destructive",
      });
    },
  });

  const handleCreateNote = (noteData: { title: string; entries: { content: string; audio_url?: string }[] }) => {
    createNoteMutation.mutate({
      ...noteData,
      processingType: ProcessingVariant.SUMMARY
    });
    setIsEditorOpen(false);
  };

  const handleUpdateNote = (noteData: { id: string; title: string; entries: { id?: string; content: string; audio_url?: string }[] }) => {
    updateNoteMutation.mutate({
      ...noteData,
      processingType: editingNote?.processingType || ProcessingVariant.SUMMARY
    });
    setEditingNote(undefined);
    setIsEditorOpen(false);
  };

  const handleEditNote = (note: Note) => {
    setEditingNote(note);
    setIsEditorOpen(true);
  };

  const handleDeleteNote = (id: string) => {
    deleteNoteMutation.mutate(id);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-500 via-pink-500 to-red-500 flex justify-center items-center p-4">
        <Loader2 className="h-12 w-12 md:h-16 md:w-16 text-white animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex justify-center items-center p-4 text-white">
        <span>Error loading notes.</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-500 via-pink-500 to-red-500 py-4 px-2 md:py-10 md:px-4">
      <div className="container max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 md:mb-12 bg-white/20 backdrop-blur-sm rounded-xl p-4 md:p-6 shadow-2xl">
          <div className="flex flex-col md:flex-row items-start md:items-center space-y-2 md:space-y-0 md:space-x-6 mb-4 md:mb-0">
            <div className="flex items-center space-x-3">
              <NotebookPen className="h-6 w-6 md:h-8 md:w-8 text-white" />
              <h1 className="text-2xl md:text-4xl font-bold text-white drop-shadow-lg">
                My Notes
              </h1>
            </div>
          </div>
          <CreateNoteButton 
            onClick={() => setIsEditorOpen(true)} 
            className="w-full md:w-auto bg-white/30 hover:bg-white/50 text-white transition-all duration-300 flex items-center justify-center space-x-2 px-4 py-2 rounded-full text-sm md:text-base"
          >
            <PlusCircle className="h-4 w-4 md:h-5 md:w-5" />
            <span>New Note</span>
          </CreateNoteButton>
        </div>

        {notes.length === 0 ? (
          <div className="flex justify-center items-center p-4">
            <EmptyState
              title="No Notes Yet"
              description="Create your first note to get started"
            />
          </div>
        ) : (
          <div className="grid gap-4 md:gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {notes.map((note) => (
              <div 
                key={note.id} 
                className="transform transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl"
              >
                <NoteCard
                  note={note}
                  onEdit={handleEditNote}
                  onDelete={handleDeleteNote}
                  className="bg-white/20 backdrop-blur-sm rounded-xl border border-white/30 hover:border-white/50 transition-all duration-300"
                />
              </div>
            ))}
          </div>
        )}

        <div className="fixed bottom-4 right-4 md:bottom-8 md:right-8 flex items-center space-x-2 md:space-x-4">
          <div className="bg-white/30 backdrop-blur-sm p-2 md:p-3 rounded-full shadow-2xl animate-pulse hidden md:flex">
            <Sparkles className="h-4 w-4 md:h-6 md:w-6 text-white" />
          </div>
          <div className="bg-white/30 backdrop-blur-sm p-2 md:p-3 rounded-full shadow-2xl animate-bounce hidden md:flex">
            <Lightbulb className="h-4 w-4 md:h-6 md:w-6 text-white" />
          </div>
          <div className="bg-white/30 backdrop-blur-sm p-2 md:p-3 rounded-full shadow-2xl hover:animate-spin">
            <Rocket className="h-4 w-4 md:h-6 md:w-6 text-white" />
          </div>
        </div>

        <NoteEditor
          note={editingNote}
          open={isEditorOpen}
          onOpenChange={(open) => {
            setIsEditorOpen(open);
            if (!open) setEditingNote(undefined);
          }}
          onSave={editingNote ? handleUpdateNote : handleCreateNote}
          currentUserId={user?.id}
        />
      </div>
    </div>
  );
};

export default Index;
