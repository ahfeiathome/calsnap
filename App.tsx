import { useEffect, useState, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Calendar from 'expo-calendar';
import type { EventData, HistoryEntry } from './src/types';
import {
  extractEventFromImage,
  extractEventFromText,
  getApiKey,
} from './src/claude';
import { getHistory, saveToHistory } from './src/storage';

type Screen = 'input' | 'preview' | 'history';
type InputMode = 'photo' | 'text';

// Theme colors
const PRIMARY = '#1A237E';
const ACCENT = '#5C6BC0';
const ACCENT_LIGHT = '#7986CB';
const BG = '#F5F5FA';

export default function App() {
  const [screen, setScreen] = useState<Screen>('input');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Input state
  const [inputMode, setInputMode] = useState<InputMode>('photo');
  const [textInput, setTextInput] = useState('');

  // Event preview state
  const [eventData, setEventData] = useState<EventData>({
    title: '',
    date: '',
    start_time: '',
    end_time: '',
    location: '',
    description: '',
  });

  // History state
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const entries = await getHistory();
      setHistory(entries);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to load history';
      setError(msg);
    }
  }, []);

  useEffect(() => {
    if (screen === 'history') {
      loadHistory();
    }
  }, [screen, loadHistory]);

  // Clear success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [successMessage]);

  const handlePickImage = async (useCamera: boolean) => {
    try {
      setError(null);

      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setError('Camera permission is required to scan event flyers.');
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setError('Photo library permission is required to select images.');
          return;
        }
      }

      const result = await (useCamera
        ? ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 0.7,
            base64: true,
          })
        : ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.7,
            base64: true,
          }));

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setLoading(true);

      const base64 = asset.base64;
      if (!base64) {
        setError('Failed to read image data.');
        setLoading(false);
        return;
      }

      const apiKey = getApiKey();
      if (!apiKey) {
        setError(
          'Missing API key. Set EXPO_PUBLIC_ANTHROPIC_API_KEY in your .env file.',
        );
        setLoading(false);
        return;
      }

      const data = await extractEventFromImage(base64, apiKey);
      setEventData(data);
      setScreen('preview');
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to process image';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleExtractText = async () => {
    if (!textInput.trim()) {
      setError('Please paste some event details first.');
      return;
    }

    try {
      setError(null);
      setLoading(true);

      const apiKey = getApiKey();
      if (!apiKey) {
        setError(
          'Missing API key. Set EXPO_PUBLIC_ANTHROPIC_API_KEY in your .env file.',
        );
        setLoading(false);
        return;
      }

      const data = await extractEventFromText(textInput.trim(), apiKey);
      setEventData(data);
      setTextInput('');
      setScreen('preview');
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to extract event';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const getDefaultCalendarId = async (): Promise<string> => {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Calendar permission is required to add events.');
    }

    const calendars = await Calendar.getCalendarsAsync(
      Calendar.EntityTypes.EVENT,
    );

    // Prefer default calendar
    const defaultCal = calendars.find(
      (c) =>
        c.allowsModifications &&
        (c.isPrimary || c.source?.name === 'Default'),
    );
    if (defaultCal) return defaultCal.id;

    // Fallback: first writable calendar
    const writable = calendars.find((c) => c.allowsModifications);
    if (writable) return writable.id;

    // Last resort on iOS: create a calendar
    if (Platform.OS === 'ios') {
      const defaultSource = calendars.find(
        (c) => c.source?.type === 'local',
      )?.source;
      const newCalId = await Calendar.createCalendarAsync({
        title: 'CalSnap',
        color: ACCENT,
        entityType: Calendar.EntityTypes.EVENT,
        sourceId: defaultSource?.id,
        source: {
          isLocalAccount: true,
          name: 'CalSnap',
          type: 'local' as Calendar.SourceType,
        },
        name: 'CalSnap',
        ownerAccount: 'personal',
        accessLevel: Calendar.CalendarAccessLevel.OWNER,
      });
      return newCalId;
    }

    throw new Error('No writable calendar found.');
  };

  const handleAddToCalendar = async () => {
    try {
      setError(null);

      const calendarId = await getDefaultCalendarId();

      const startDate = new Date(`${eventData.date}T${eventData.start_time}:00`);
      const endDate = new Date(`${eventData.date}T${eventData.end_time}:00`);

      await Calendar.createEventAsync(calendarId, {
        title: eventData.title,
        startDate,
        endDate,
        location: eventData.location || undefined,
        notes: eventData.description || undefined,
      });

      // Save to history
      await saveToHistory({
        id: Date.now().toString(),
        event: { ...eventData },
        status: 'added',
        created_at: new Date().toISOString(),
      });

      setSuccessMessage(
        `"${eventData.title}" added to calendar for ${eventData.date}`,
      );
      setScreen('input');
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to add event to calendar';
      setError(msg);
    }
  };

  const handleDiscard = async () => {
    await saveToHistory({
      id: Date.now().toString(),
      event: { ...eventData },
      status: 'discarded',
      created_at: new Date().toISOString(),
    });
    setScreen('input');
  };

  // ─── Screen 1: Input ───
  const renderInputScreen = () => (
    <ScrollView
      style={styles.flex1}
      contentContainerStyle={styles.screenContainer}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>CalSnap</Text>
      <Text style={styles.subtitle}>
        Photo a flyer or paste text to extract events
      </Text>

      {/* Mode Toggle */}
      <View style={styles.modeToggle}>
        <TouchableOpacity
          style={[
            styles.modeButton,
            inputMode === 'photo' && styles.modeButtonActive,
          ]}
          onPress={() => setInputMode('photo')}
        >
          <Text
            style={[
              styles.modeButtonText,
              inputMode === 'photo' && styles.modeButtonTextActive,
            ]}
          >
            Scan Photo
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.modeButton,
            inputMode === 'text' && styles.modeButtonActive,
          ]}
          onPress={() => setInputMode('text')}
        >
          <Text
            style={[
              styles.modeButtonText,
              inputMode === 'text' && styles.modeButtonTextActive,
            ]}
          >
            Paste Text
          </Text>
        </TouchableOpacity>
      </View>

      {inputMode === 'photo' ? (
        <View style={styles.buttonsColumn}>
          <TouchableOpacity
            style={[styles.bigButton, { backgroundColor: PRIMARY }]}
            onPress={() => handlePickImage(true)}
            disabled={loading}
          >
            <Text style={styles.bigButtonIcon}>{'📷'}</Text>
            <Text style={styles.bigButtonText}>Take Photo</Text>
            <Text style={styles.bigButtonHint}>
              Snap a flyer, poster, or invitation
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bigButton, { backgroundColor: ACCENT }]}
            onPress={() => handlePickImage(false)}
            disabled={loading}
          >
            <Text style={styles.bigButtonIcon}>{'🖼'}</Text>
            <Text style={styles.bigButtonText}>Choose from Gallery</Text>
            <Text style={styles.bigButtonHint}>
              Pick an existing event image
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.textInputContainer}>
          <TextInput
            style={styles.textArea}
            value={textInput}
            onChangeText={setTextInput}
            placeholder="Paste event details here...&#10;&#10;e.g. &quot;Book Club Meeting, March 25 at 7pm, Downtown Library, Room 201&quot;"
            placeholderTextColor="#9ca3af"
            multiline
            textAlignVertical="top"
          />
          <TouchableOpacity
            style={[
              styles.extractButton,
              { opacity: textInput.trim() ? 1 : 0.5 },
            ]}
            onPress={handleExtractText}
            disabled={loading || !textInput.trim()}
          >
            <Text style={styles.extractButtonText}>Extract Event</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={styles.loadingText}>Extracting event details...</Text>
        </View>
      )}
    </ScrollView>
  );

  // ─── Screen 2: Event Preview ───
  const renderPreviewScreen = () => (
    <ScrollView
      style={styles.flex1}
      contentContainerStyle={styles.screenContainer}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Event Preview</Text>
      <Text style={styles.subtitle}>Review and edit before adding</Text>

      <View style={styles.formCard}>
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.formInput}
          value={eventData.title}
          onChangeText={(v) =>
            setEventData((prev) => ({ ...prev, title: v }))
          }
          placeholder="Event name"
          placeholderTextColor="#9ca3af"
        />

        <Text style={styles.label}>Date</Text>
        <TextInput
          style={styles.formInput}
          value={eventData.date}
          onChangeText={(v) =>
            setEventData((prev) => ({ ...prev, date: v }))
          }
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#9ca3af"
        />

        <View style={styles.timeRow}>
          <View style={styles.timeField}>
            <Text style={styles.label}>Start Time</Text>
            <TextInput
              style={styles.formInput}
              value={eventData.start_time}
              onChangeText={(v) =>
                setEventData((prev) => ({ ...prev, start_time: v }))
              }
              placeholder="HH:MM"
              placeholderTextColor="#9ca3af"
            />
          </View>
          <View style={styles.timeField}>
            <Text style={styles.label}>End Time</Text>
            <TextInput
              style={styles.formInput}
              value={eventData.end_time}
              onChangeText={(v) =>
                setEventData((prev) => ({ ...prev, end_time: v }))
              }
              placeholder="HH:MM"
              placeholderTextColor="#9ca3af"
            />
          </View>
        </View>

        <Text style={styles.label}>Location</Text>
        <TextInput
          style={styles.formInput}
          value={eventData.location}
          onChangeText={(v) =>
            setEventData((prev) => ({ ...prev, location: v }))
          }
          placeholder="Venue or address"
          placeholderTextColor="#9ca3af"
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.formInput, { minHeight: 60 }]}
          value={eventData.description}
          onChangeText={(v) =>
            setEventData((prev) => ({ ...prev, description: v }))
          }
          placeholder="Brief description"
          placeholderTextColor="#9ca3af"
          multiline
        />
      </View>

      <View style={styles.previewActions}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: PRIMARY }]}
          onPress={handleAddToCalendar}
        >
          <Text style={styles.actionButtonText}>Add to Calendar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: '#94a3b8' }]}
          onPress={handleDiscard}
        >
          <Text style={styles.actionButtonText}>Discard</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // ─── Screen 3: History ───
  const renderHistoryScreen = () => (
    <View style={styles.screenContainer}>
      <Text style={styles.title}>History</Text>
      <Text style={styles.subtitle}>Recent event extractions</Text>

      {history.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No events yet.</Text>
          <Text style={styles.emptyHint}>
            Scan a flyer or paste text to get started!
          </Text>
        </View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.historyRow}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      item.status === 'added' ? '#22c55e' : '#94a3b8',
                  },
                ]}
              />
              <View style={styles.historyInfo}>
                <Text style={styles.historyTitle}>{item.event.title}</Text>
                <Text style={styles.historyDate}>
                  {item.event.date} {'\u00B7'}{' '}
                  {item.status === 'added' ? 'Added' : 'Discarded'}
                </Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)}>
            <Text style={styles.errorDismiss}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      {successMessage && (
        <View style={styles.successBanner}>
          <Text style={styles.successText}>{successMessage}</Text>
        </View>
      )}

      <View style={styles.flex1}>
        {screen === 'input' && renderInputScreen()}
        {screen === 'preview' && renderPreviewScreen()}
        {screen === 'history' && renderHistoryScreen()}
      </View>

      {/* Bottom Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={styles.tab}
          onPress={() => setScreen('input')}
        >
          <Text
            style={[
              styles.tabIcon,
              screen === 'input' && styles.tabActive,
            ]}
          >
            {'📷'}
          </Text>
          <Text
            style={[
              styles.tabLabel,
              screen === 'input' && styles.tabLabelActive,
            ]}
          >
            Input
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tab}
          onPress={() => setScreen('history')}
        >
          <Text
            style={[
              styles.tabIcon,
              screen === 'history' && styles.tabActive,
            ]}
          >
            {'📋'}
          </Text>
          <Text
            style={[
              styles.tabLabel,
              screen === 'history' && styles.tabLabelActive,
            ]}
          >
            History
          </Text>
        </TouchableOpacity>
      </View>

      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  flex1: {
    flex: 1,
  },
  screenContainer: {
    flexGrow: 1,
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: PRIMARY,
    textAlign: 'center',
    marginTop: 12,
  },
  subtitle: {
    fontSize: 15,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 24,
    marginTop: 4,
  },

  // Mode toggle
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: '#E8EAF6',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: PRIMARY,
  },
  modeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748b',
  },
  modeButtonTextActive: {
    color: '#ffffff',
  },

  // Photo input
  buttonsColumn: {
    gap: 16,
    marginTop: 8,
  },
  bigButton: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  bigButtonIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  bigButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  bigButtonHint: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },

  // Text input
  textInputContainer: {
    gap: 12,
  },
  textArea: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#C5CAE9',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#1e293b',
    minHeight: 160,
    textAlignVertical: 'top',
  },
  extractButton: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  extractButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },

  // Loading
  loadingOverlay: {
    marginTop: 32,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: ACCENT,
    fontWeight: '600',
  },

  // Preview form
  formCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#C5CAE9',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
    marginBottom: 6,
    marginTop: 14,
  },
  formInput: {
    backgroundColor: '#F5F5FA',
    borderWidth: 1,
    borderColor: '#E8EAF6',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: '#1e293b',
  },
  timeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timeField: {
    flex: 1,
  },
  previewActions: {
    gap: 10,
    marginTop: 20,
  },
  actionButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },

  // History
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 18,
    color: '#94a3b8',
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 14,
    color: '#cbd5e1',
    marginTop: 4,
    textAlign: 'center',
  },
  listContent: {
    gap: 8,
  },
  historyRow: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8EAF6',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  historyInfo: {
    flex: 1,
  },
  historyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
  },
  historyDate: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#C5CAE9',
    backgroundColor: '#ffffff',
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  tabIcon: {
    fontSize: 22,
    opacity: 0.5,
  },
  tabActive: {
    opacity: 1,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },
  tabLabelActive: {
    color: PRIMARY,
  },

  // Error / Success banners
  errorBanner: {
    backgroundColor: '#fef2f2',
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  errorDismiss: {
    color: '#dc2626',
    fontWeight: '700',
    fontSize: 13,
  },
  successBanner: {
    backgroundColor: '#f0fdf4',
    padding: 12,
    alignItems: 'center',
  },
  successText: {
    color: '#16a34a',
    fontSize: 13,
    fontWeight: '600',
  },
});
