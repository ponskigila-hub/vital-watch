"""Explicit opt-in smoke test; sends only a small entirely synthetic demo."""
import argparse
from .app.config import Settings
from .app.language import GeminiLanguage, references
from .app.schemas import LanguageRequest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--send-demo', action='store_true', help='Make one external request with synthetic educational evidence')
    args = parser.parse_args()
    provider = GeminiLanguage(Settings())
    print('Gemini configuration:', provider.status()['status'])
    if not args.send_demo:
        print('No external request made. Use --send-demo after configuring the backend key.')
        return
    if not provider.status()['external_calls_enabled']:
        parser.exit(1, 'Backend key/provider is not configured. No external request made.\n')
    request = LanguageRequest(operation='guidance',patient_id='synthetic-smoke-demo',as_of_hour=2,observations=[{'ICULOS':1,'HR':80},{'ICULOS':2,'HR':82}],references=references(),evidence={'observation:HR:1':{'measurement':'HR','hour':1,'value':80},'observation:HR:2':{'measurement':'HR','hour':2,'value':82},'prediction:current':{'status':'unavailable','score':None},'data:quality':{'missing_vitals':['Temp','O2Sat','SBP','MAP','Resp']}})
    try:
        result=provider.respond(request)
        print('Validated response:',result.status,'· model:',result._model_used,'· observations:',len(result.observations),'· review steps:',len(result.actions))
    except Exception as exc:
        code = getattr(exc, 'code', None)
        if code == 402:
            parser.exit(1, 'Gemini project credits are depleted (HTTP 402). No fallback attempted for billing errors.\n')
        if code == 429:
            parser.exit(1, 'Gemini quota exhausted (HTTP 429). No fallback attempted for quota errors.\n')
        if code in (401,403):
            parser.exit(1, 'Gemini key/project access was rejected. No fallback attempted.\n')
        if type(exc).__name__ == 'ValueError':
            print('Validation gate:', str(exc)[:180])
        if code is not None:
            print('Provider HTTP status:', code)
            if code == 400:
                print('Schema/configuration detail:', str(getattr(exc, 'message', '')).replace(provider.settings.gemini_api_key, '[redacted]')[:500])
        parser.exit(1,'Gemini smoke test failed. Check key access, model availability, quota, and response validation. No credential or provider response was logged.\n')
    finally:
        provider.client.close()


if __name__ == '__main__':
    main()
