#!/usr/bin/env python
import sys
import subprocess
import os

def check_dependencies():
    print("Checking Python dependencies for IBM Watson STT...")
    
    required_packages = [
        'ibm-watson',
        'ibm-cloud-sdk-core'
    ]
    
    missing = []
    
    for package in required_packages:
        try: 
            __import__(package.replace('-', '_'))
            print(f"✅ {package} is installed")
        except ImportError:
            print(f"❌ {package} is NOT installed")
            missing.append(package)
    
    if missing:
        print("\nMissing packages. Install with:")
        print(f"pip install {' '.join(missing)}")
        return False
    else:
        print("\nAll dependencies are installed!")
        return True

if __name__ == "__main__":
    success = check_dependencies()
    sys.exit(0 if success else 1) 