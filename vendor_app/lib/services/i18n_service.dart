import 'package:shared_preferences/shared_preferences.dart';

class I18nService {
  static final I18nService _instance = I18nService._internal();
  factory I18nService() => _instance;
  I18nService._internal();

  SharedPreferences? _prefs;
  static const _languageKey = 'user_language';
  static const _currencyKey = 'user_currency';

  static const _languages = {
    'en': 'English',
    'fr': 'Français',
    'pt': 'Português',
    'ar': 'العربية',
    'es': 'Español',
    'zh': '中文',
  };

  static const _currencies = {
    'USD': '\$ US Dollar',
    'GBP': '£ British Pound',
    'EUR': '€ Euro',
    'NGN': '₦ Nigerian Naira',
    'KES': 'KES Kenyan Shilling',
    'GHS': 'GHS Ghana Cedi',
    'ZAR': 'R South African Rand',
  };

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  String get language => _prefs?.getString(_languageKey) ?? 'en';
  String get currency => _prefs?.getString(_currencyKey) ?? 'NGN';

  String get languageName => _languages[language] ?? 'English';
  String get currencyName => _currencies[currency] ?? '₦ Nigerian Naira';

  Future<void> setLanguage(String lang) async {
    await _prefs?.setString(_languageKey, lang);
  }

  Future<void> setCurrency(String currency) async {
    await _prefs?.setString(_currencyKey, currency);
  }

  Future<void> clear() async {
    await _prefs?.remove(_languageKey);
    await _prefs?.remove(_currencyKey);
  }
}