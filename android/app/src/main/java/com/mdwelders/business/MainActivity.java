package com.mdwelders.business;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MdwSpeechRecognitionPlugin.class);
        registerPlugin(MdwSecureStoragePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
